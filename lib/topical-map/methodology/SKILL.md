---
name: topical-map-creation
description: >-
  Create comprehensive topical maps following Koray Tugberk Gubur's Semantic
  SEO methodology for building topical authority. Covers entities, knowledge
  domains, query semantics, ontology, topic generation, RPP filtering, SERP
  clustering, Quality/Trending Nodes, internal linking, NavBoost,
  DataForSEO/Ahrefs automation, AI Overview strategy, Launch Conditions
  (v4.7), Reject List + QA layer (v4.8). v4.9 adds the Polarity/Condition
  modifier axis (with X / without X / painless / after Y) + symptom-variant
  expander — both poles of a searched attribute are distinct intents. Trigger
  on: "topical map", "content strategy", "keyword map", "topical authority",
  "build my site structure", "content plan", "local SEO map", "affiliate site
  architecture", "PM handoff", "sprint plan", "content calendar", "launch
  conditions", "page or segment". Do NOT trigger for individual blog posts;
  use seo-blog-generator.
metadata:
  author: nirotnt
  version: '4.9'
---

# Topical Map Creation Skill

A methodology for creating topical maps that build topical authority, based on Koray Tugberk Gubur's *Semantic SEO for Topical Authority* course and supplementary teachings (2024–2026).

**Version history (v4.2 → current):** see `references/changelog.md`. Current version: **v4.9**.

---

## Reference Files

This skill uses progressive disclosure. The core workflow is below. Detailed reference material is in `references/` — read ONLY what's needed for the current phase.

| File | Contents | Read When |
|------|----------|-----------|
| `references/step-overview.md` | Bird's-eye view of all 31 steps across 9 phases with key outputs per step | Quick orientation before execution, or when user asks "what are the steps?" |
| `references/procedure-detailed.md` | Full 31-step procedure with substeps, examples, and methodology details | Executing any specific step and need full detail |
| `references/procedure-addendum.md` | Mode guards for Steps 8.1, 13, 14, 23 + universal quantitative claims rule | Always — read alongside any patched step |
| `references/v41-additions.md` | Full specs: Query Fan-Out (A), Generative Intent (B), Passage Independence (C), llms.txt (D), Phase 8 Maintenance (E), Share of Model KPI (F), Format Column (G) | When executing any v4.1 feature — read the relevant section before producing output |
| `references/aio-risk-score.md` *(v4.3)* | AIO Risk Score column methodology: per-topic AI Overview exposure scoring, Seer 2026 study findings, scoring rubric, mitigation playbook | When user requests AIO-aware mapping, or for any YMYL/commercial topic vulnerable to AI Overview displacement |
| `references/site-type-playbooks.md` *(v4.4)* | 7 site-type playbooks (New Build, Existing Expansion, Ecommerce, Publisher, Local, Affiliate, AI/GEO) + the 4 cross-cutting analyses: SERP-Overlap Decision Tree, Winning Page Type, Node Function taxonomy, Retrieval Confidence Map | Phase 1 — always, immediately after declaring mode/tier, to pick the playbook; keep open through Phase 4–6 |
| `references/supplementary.md` | S1–S28: N-grams, internal linking, visual semantics, algorithmic authorship, NavBoost, frame semantics, EAV, AI Overview/GEO, ecosystem authority, perspectives/safe answers, topical map matrix, topic share measurement | Applying advanced optimization or a user asks about a specific supplementary topic |
| `references/dataforseo.md` | DataForSEO API v3 integration: endpoint mapping, authenticated pipeline, SERP clustering, PAA extraction, AI Optimization, cost estimates | Automating data collection (Tool-Assisted mode only) |
| `references/gpt-agents.md` | Koray's 48 custom GPT agents across 9 categories | User wants to use Koray's GPT agent workflow |
| `references/case-studies.md` | 2025–2026 case study results and reference examples | Need examples, benchmarks, or proof points |
| `references/pm-content-plan-spec.md` | Tier 4 PM Content Plan: XLSX workbook structure (6 sheets), writer brief template, sprint assignment logic, difficulty scoring rubric, jargon-to-PM mapping, formatting spec, honesty rules, quality checklist | Generating Tier 4 output — always read before producing PM handoff |
| `references/author-cluster-assignment.md` *(v4.6)* | Per-author topical authority (Authority Signature, US8458196B1): the one-author-per-cluster assignment rule, the authorship-percent x topic-weight mechanic, map columns, and coverage checks | Phase 6 — when assigning author entities to clusters, or whenever the map must carry author attribution |
| `references/launch-conditions.md` *(v4.7)* | New-site / zero-history launch mechanics: BQA check → NARROW-ROOT vs WIDE-FIRST breadth, Page-or-Segment (PoS) 4-factor test + PoS map column, launch URL budget, ranking-state KPI ladder (impressions-first, Phase A/B/C), expansion-origin + subfolder-proof selection, Checkpoint 1 declaration block, gate handoffs (AAG NEW-DOMAIN, SCN SQ-07/08/09) | Phase 1 — MANDATORY when Site Type = New Build, site age < 12mo, or central entity has ≈0 impressions; keep open through Phase 4 (PoS) and Phase 6 (budget + ladder) |
| `references/v48-additions.md` *(v4.8)* | Full specs for the 8 deliverable/QA upgrades: Key Findings (§A), Reject List (§B), journey-stage organization (§C), Bridge Cluster tag (§D), Trending Node lifecycle (§E), Orphan-Reference Check (§F), cross-source volume verification (§G), template-separation notes (§H) | Executing any v4.8 feature — read the relevant section before producing output |

**Repository fallback:** If `references/` files are not found locally (skill directory reset between sessions): fetch from `madrank8/ai-brain/skills/user/topical-map-creation/references/` via GitHub.

**Ahrefs MCP integration:** When connected, use for competitor keyword analysis, content gap identification, domain overview, and backlink profiling. Supplements DataForSEO for Steps 8.1, 9, 13, and 26.

**Pairs with (downstream skills):**

| Skill | Role in pipeline |
|-------|------------------|
| `content-brief-generator` | Converts topical map rows → YAML content briefs (standardized format) |
| `seo-blog-generator` | Converts briefs → publish-ready Markdown articles |
| `schema-markup-generator` | Generates JSON-LD from Tier 3 Entity Map output |
| `article-visual-generator` | Produces charts, diagrams, illustrations for article visual placeholders |
| `clutter-score-gate` | Pre-publish quality gate for listicles / commercial roundups produced from the map |
| `redteam-multi` | Multi-agent red-team review of generated content |
| `classifier-os` | Site audit / classifier gap diagnosis (use to validate the map landed) |
| `geo-aeo-layer` | AEO/GEO layer for AI citation optimization across all map topics |
| `firsthand-review-casino` | First-hand review pipeline (for sweepstakes/casino topical maps) |
| `vas-apostacasa` | Visual Authority System (for apostacasa.com Brazilian Portuguese betting maps) |

---

## EXECUTION MODES (Mandatory — Declare Before Proceeding)

Before starting any work, Claude MUST declare which mode applies and state it to the user. The mode determines what Claude is allowed to produce and what must remain marked as unresolved.

### Manual Mode

**Available resources:** Claude's training knowledge, user-provided context, web_search/web_fetch.
**What Claude may produce:** Strategic map with provisional labels. Qualitative priority tiers (High / Medium / Low) with one-sentence reasoning per topic. Entity-attribute pairs derived from semantic analysis. Intent classification from training knowledge.
**What Claude must NOT produce:** Search volume numbers, competitor DR/traffic metrics, SERP overlap percentages, Wikidata Q-IDs, or any data requiring Ahrefs/DataForSEO unless obtained via web_search in this session.
**Labeling:** All clustering decisions marked `[ESTIMATED — no SERP data]`. All priority assignments include reasoning. Entity Map fields without verified data marked `[UNRESOLVED]`.

### Tool-Assisted Mode

**Available resources:** Ahrefs MCP, DataForSEO API, web_search/web_fetch, plus Claude's knowledge.
**What Claude may produce:** Full map with evidence-backed RPP scores, verified competitor metrics, SERP-based clustering with overlap data, search volume figures.
**Requirements:** Every metric must cite the tool call that produced it. Do not mix tool-derived data with invented data in the same column.

### Audit Mode

**Available resources:** An existing topical map provided by the user, plus any tools available.
**What Claude produces:** Gap analysis, cannibalization review, expansion recommendations, structural critique, orphan-reference check (Phase 5.7), and — when data tools are available — a cross-source verification of the map's volume/KD claims per Honesty Rule 9 *(v4.8)*.
**What Claude does NOT do:** Regenerate the full map from scratch. The audit modifies an existing map.

---

## OUTPUT TIERS (Default to Tier 1)

Not every invocation needs all tiers. Claude produces Tier 1 by default and asks before producing Tier 2 or 3 (or 4 for PM handoff).

### Tier 1: Strategic Map (Always Produced)

| Column | Description |
|--------|-------------|
| **Section** | Core or Outer |
| **Sub-section** | Topical cluster within the section |
| **Raw Topic** | The topic phrase / page concept |
| **Search Intent** | 1 of 5 types *(v4.1)*: Informational / Commercial / Transactional / Navigational / Generative (GEN) |
| **Priority** | High / Medium / Low — with reasoning |
| **Node Type** | Quality Node / Trending Node / Standard |
| **Fan-Out Tag** *(v4.1)* | Which Quality Node's fan-out tree this topic belongs to (or `—` if not in a tree) |
| **AIO Risk Score** *(v4.3)* | Low / Medium / High / Critical — read `references/aio-risk-score.md` for scoring rubric |
| **Bridge Tag** *(v4.8)* | `BRIDGE` if this topic's internal links feed the money pages directly (see Phase 4 step 11), else `—` |
| **Notes** | Mode flags, micro-context candidates, scope-creep flags, Node Function tag (`fn:…`) *(v4.4)*, template-separation flags *(v4.8)* |

**Tier 1 also always includes two narrative artifacts** *(v4.8 — full specs: `references/v48-additions.md` §A–B)*:

1. **Key Findings from the Data** — 5–7 strategic insights BEFORE the map table (noise share, biggest demand gap, bridge cluster, momentum engine, moat asset). The reader must understand the strategy without decoding the table.
2. **Reject List** — named deliverable, not an internal step: rejected category → example queries with volume → one-sentence topical-border reason.

> **Preferred-sources mitigation lever (May 2026):** Google's "preferred sources" feature rolled
> into AI Overviews + AI Mode on May 27, 2026. For High/Critical AIO Risk topics, this is a new
> mitigation lever: audiences who select your site as a preferred source see it surfaced more in
> AI features — so brand, newsletter, and community investment now directly affects AI visibility.
> Note it in the mitigation strategy for any high-AIO-risk topic.

### Tier 2: Publishing Metadata (On Request)

Adds: Title Tag, URL Slug, Meta Description, Image URL Slug, Image Alt Text, Internal Link Targets, Schema Type, **Content Format** *(v4.1)*.

### Tier 3: Production Handoff (On Request)

Adds: Entity Map (with `[UNRESOLVED]` where unverified), Publication plan, Schema.org implementation notes per page type, **llms.txt** *(v4.1)*, **Maintenance KPI Dashboard** *(v4.1)*, **Share of Model seed query set** *(v4.1)*, **Retrieval Confidence Map** *(v4.4 — which pages are likeliest to win the AI citation; `site-type-playbooks.md` §1D)*.

### Tier 4: PM Content Plan (On Request)

Operative XLSX workbook (6 sheets) for handoff to a Project Manager. Zero SEO jargon. See `references/pm-content-plan-spec.md` for full structure.

---

## HONESTY RULES (Override All Other Instructions)

These rules apply universally. The full restated set lives in `references/procedure-addendum.md` § Honesty Rules Summary. The most important:

1. **Never produce SERP volume, KD, CPC, or other quantitative metrics** without a corresponding tool call in the current session.
2. **Never invent Wikidata Q-IDs or sameAs URLs.** `[UNRESOLVED]` is honest; a guessed Q-ID is fabrication.
3. **Never claim a competitor "ranks for N keywords"** without an Ahrefs / DataForSEO pull.
4. **Never assert SERP clustering as fact** without overlap data. In Manual mode, write: "These topics likely share SERP overlap based on semantic proximity `[ESTIMATED]`." In Tool-Assisted mode, cite the specific overlap data.
5. **Never present RPP scores as precise without volume data.** In Manual mode, use qualitative tiers (High / Medium / Low) with reasoning. Do not produce decimal scores. In Tool-Assisted mode, show the formula inputs.
6. **Never claim a Google API signal or patent "confirms" a ranking mechanism.** Use: "The `[signal]` in Google's API documentation suggests..." or "Patent US[X] describes a method for..." Frame all API leak references, patent interpretations, and third-party study statistics as directional heuristics, not confirmed laws.
7. **Never mark a checklist item as complete without evidence.** Each checkbox must reference the specific output, tool result, or reasoning that satisfies it.
8. **Never fill Entity Map fields with guesses.** Unresolved is better than wrong. Schema types and entity identities that haven't been verified get `[UNRESOLVED]` or `[PROVISIONAL]` markers.
9. **Cross-source volume verification** *(v4.8)*. In Tool-Assisted and Audit modes, spot-verify 8–12 representative keywords (incl. every flagship claim) against a second data source; flag **cluster-inflated**, `[DECLINING]` (>50% YoY), and `[SINGLE-SOURCE — directional]` figures. Full flag taxonomy: `references/v48-additions.md` §G.

---

## FOUNDATIONAL THEORY (Summary)

> For deep-dive theory, read `references/procedure-detailed.md` Steps 1–7.

### Topical Authority Formula

```
Topical Authority = (Historical Data × Topical Coverage) / Cost of Retrieval
```

- **Historical Data:** Accumulated engagement, ranking history, user interaction signals through consistent publishing
- **Topical Coverage:** How comprehensively a site covers all facets of its core topic (entities, attributes, relationships, queries)
- **Cost of Retrieval:** How efficiently search engines can crawl, parse, and understand the content. Koray argues this is MORE important than topical authority alone.

### Author Authority Signature (Per-Author Topical Authority) *(v4.6)*

Topical authority is also a **per-author** attribute, not only a site attribute. Google patent **US8458196B1** models it as `AuthoritySignatureValue(author, topic) = sum of [ AuthorshipPercent x TopicWeight ]` across documents - a pure accumulator, where TopicWeight is an NLP confidence the page is about the topic and co-authors split the share. (Lapsed / Drive-era patent: design philosophy aligned with the QRG E-E-A-T author-entity direction, not a confirmed live ranking factor.)

Map consequence: **assign one named author entity per cluster.** Concentration compounds a single author's signature on a topic; scattering one author across clusters starves every topic. Single-topic cluster pages also earn higher TopicWeight per piece. Record the assignment at the cluster level (Phase 6) and carry `Author Entity -> Person @id -> sameAs` into the Tier 3 Entity Map for `schema-markup-generator`. Full rule: `references/author-cluster-assignment.md`.

### Four Fundamental Ranking Metrics (Heuristic Framework)

These are directional models derived from Koray's methodology and public Google documentation. They describe likely mechanisms, not confirmed internals.

1. **PageRank** — Link-based authority (now likely one input into composite quality scoring)
2. **Topicality** — Internal semantics, content relationships, user navigation signals
3. **Popularity** — Click satisfaction, engagement, NavBoost-type behavioral data
4. **Trust** — E-E-A-T signals, entity recognition, brand consistency

### 5 Core Components of a Topical Map

1. **Source Context:** Website identity, purpose, monetization model
2. **Central Entity:** The main entity the site revolves around
3. **Central Search Intent:** The primary action/outcome users seek
4. **Core Section:** Topics directly related to Central Entity + Central Search Intent — where monetization happens; signals flow here
5. **Outer Section:** Supporting topics that build breadth and transfer authority inward

### Key Principles

- **Semantic Content Network:** Every paragraph, heading, visual, internal link organized for contextual richness and interconnection
- **Salience:** Subject position in semantic triples weighs heavier than object position
- **Businesses with Function:** Google likely ranks sites difficult to AI-replicate over pure info sites
- **Attributes > Entities:** Real differentiation is in ATTRIBUTES and their VALUES, not entity-stuffing (S16)

---

## 31-STEP PROCEDURE (Overview)

Read `references/step-overview.md` for the full 31-step procedure overview (Phases 1–9, Steps 1–31). The overview provides a bird's-eye view of every phase, step, substep, and key output. The EXECUTION WORKFLOW below is the gated implementation.

---

## EXECUTION WORKFLOW (Checkpoint-Gated)

### Phase 1: Inputs + Mode Declaration

**Ask the user for:**
1. Website URL (or concept for a new site)
2. Niche / industry
3. Target market(s) and language(s)
4. Business model / monetization
5. Existing content (if any — for audit/expansion)
6. Competitors they know about
7. Output format preference (XLSX, Markdown, or both)

**Claude determines and declares:**
- **Execution Mode:** Manual, Tool-Assisted, or Audit (based on available tools)
- **Site Type:** New Build / Existing Expansion / Ecommerce / Blog-Publisher / Local / Affiliate / AI-GEO *(v4.4)* — read `references/site-type-playbooks.md` and apply the matching playbook's defaults (node mix, winning page-type patterns, AIO posture, cannibalization watch-out). If the site spans two types (e.g. publisher + affiliate), name the primary and note the secondary.
- **Output Tier:** Default Tier 1 unless user requests more
- **Scope:** How many topics are expected (small niche: 20–40, medium: 40–80, large: 80–150+)
- **Launch Conditions** *(v4.7)* — if Site Type = New Build, site age < 12 months, or the central entity has ≈0 impressions: read `references/launch-conditions.md` and declare the full Launch Conditions block (BQA state → NARROW-ROOT / WIDE-FIRST breadth, launch URL budget, PoS column ON, ranking-state KPI ladder, gate route, expansion origin). Established properties skip this bullet.

> **⛳ CHECKPOINT 1:** User confirms scope, mode, **site type**, tier — and, when applicable, the **Launch Conditions declaration** — before proceeding.

### Phase 2: Research Foundation

> Read `references/procedure-detailed.md` Phase 1 for full detail.

1. Define all 5 Core Components explicitly
2. Identify knowledge domains and contextual layers
3. Analyze query semantics and entity elements (all 10 word relation types)
4. Build the ontology skeleton
5. **Journey-stage check** *(v4.8)*: if the Central Search Intent has distinct pre/post phases, define a two-phase intent network and organize Core sub-sections by journey stage — demand often concentrates in the neglected post-phase. See `references/v48-additions.md` §C.

**Deliverable:** A structured summary showing the 5 Core Components, knowledge domains, key entity elements (minimum: hypernyms, hyponyms, meronyms, predicates, attributes for the Central Entity), the ontology skeleton, and the journey-stage decision (single-phase or two-phase, with reasoning).

> **⛳ CHECKPOINT 2:** User reviews foundation. Confirms Core/Outer section boundaries, Central Entity, and Central Search Intent are correct before topic generation begins. This is the most important checkpoint — errors here cascade through the entire map.

### Phase 3: Generate & Expand Topics

> Read `references/procedure-detailed.md` Phase 2 for full detail.
> If Tool-Assisted with DataForSEO: read `references/dataforseo.md` Phase 1–2.
> If Ahrefs MCP available: use `ranked_keywords` and `content_gap` tools for competitor analysis.

1. Run all topic generation methods appropriate to the declared mode
2. Aim for maximum coverage before filtering
3. Merge all sources into a master topic list

**In Manual mode:** Methods 8.2 (token insertion), 8.4 (manual from ontology), 8.5 (predicates), and 8.6 (verb relationships) are fully available. Methods 8.1 (competitor analysis) and 8.3 (database finding) use web_search where possible but may be incomplete — document gaps.

**Deliverable:** A raw, unfiltered topic list. Each entry shows: the topic phrase, the generation method that produced it, and which entity-attribute pair it represents.

> **⛳ CHECKPOINT 3:** User reviews raw topic list. Can add topics, remove obvious irrelevances, and flag priorities before filtering begins.

### Phase 4: Filter, Cluster & Prioritize

> Read `references/procedure-detailed.md` Phase 3 for full detail.
> If Tool-Assisted with DataForSEO: read `references/dataforseo.md` Phase 2.
> Read `references/aio-risk-score.md` to assign AIO Risk Score per topic.
> Read `references/site-type-playbooks.md` §1A–1C for the SERP-Overlap Decision Tree, Winning Page Type analysis, and Node Function tagging *(v4.4)*.

1. Apply RPP filtering:
   - **Tool-Assisted mode:** Full formula with real volume data. Show inputs.
   - **Manual mode:** Qualitative tiers. For each topic, one sentence: "High because [reason]" / "Medium because [reason]" / "Low because [reason]"
2. Cluster decisions via the **SERP-Overlap Decision Tree** *(v4.4 — `site-type-playbooks.md` §1A)*. Classify each candidate query pair as **same intent → one page**, **partial overlap → hub + spoke**, or **distinct intent → separate pages**:
   - **Tool-Assisted mode:** measure top-10 URL overlap + dominant page type; cite the SERP pull. Sample representative pairs for large maps and flag sampling in Phase 15.
   - **Manual mode:** infer overlap from semantic proximity, label `[ESTIMATED — no SERP data]`, state the one-sentence reason. Never present an unmeasured overlap percentage.
3. Classify search intent per cluster (5-type per v4.1)
4. **Determine the Winning Page Type per cluster** *(v4.4 — §1B)* — which page type the SERP actually rewards (Tool-Assisted: dominant type across top 10, cite it; Manual: infer + `[ESTIMATED]`). This sets the Tier-2 Content Format expectation.
5. **Tag Node Function** *(v4.4 — §1C)* in Notes (`fn:Authority|Reinforcement|Retrieval|Entity|Commercial`) and sanity-check the mix against the declared site-type playbook.
6. Assign to Core Section or Outer Section with stated reasoning
7. Flag zero-demand topics as micro-context candidates
8. Apply Vastness-Depth-Momentum balance
9. **Assign AIO Risk Score** *(v4.3)* — per `references/aio-risk-score.md`
10. **Apply Page-or-Segment (PoS)** *(v4.7 — New Build / zero-history properties only)* — per `references/launch-conditions.md` §3. After RPP and the SERP-Overlap tree, run the 4-factor test (independent demand, commercial value, conversion potential, relational depth) per attribute: all four → `page`; any missing → `segment: <host page>`. When PoS and the §1A tree disagree, the stricter (fewer-URLs) verdict wins at launch. Record the resulting **launch URL budget**.

11. **Assign Bridge Cluster tag** *(v4.8)* — tag `BRIDGE` the cluster(s) linking most directly into the money pages and weight them UP one priority tier in RPP; state the bridge logic in Key Findings. See `references/v48-additions.md` §D.

**Deliverable:** Filtered topic list with: Section (Core/Outer), Sub-section, Priority (with reasoning), Intent, SERP-overlap class + cluster decision, Winning Page Type, Node Function *(v4.4)*, AIO Risk Score, **PoS** *(v4.7 — when Launch Conditions apply)*, **Bridge Tag** *(v4.8)*, and merge/micro-context flags.

> **⛳ CHECKPOINT 4:** User reviews filtered and clustered map. Confirms Core/Outer assignments, priority tiers, AIO Risk Scores, and merge decisions before the cannibalization review.

### Phase 5: Cannibalization + Focus Review (MANDATORY)

This phase is NOT optional. It runs before any map finalization.

**5.1 Intent Overlap Scan**
Compare every topic pair within the same sub-section. Flag any pair where:
- Same primary intent + same primary entity + same core attribute
- Resolution: merge into one page, or differentiate the intent angle and document why

**5.2 Entity-Attribute Deduplication**
No two standalone pages should target the identical entity-attribute pair unless:
- SERP evidence (Tool-Assisted mode) shows separate result sets, OR
- The topics serve clearly different user journey stages (awareness vs. decision)
- If neither applies, merge the weaker topic as a micro context within the stronger one

**5.3 Zero-Demand Topic Disposition**
Topics with no measurable search demand (Manual mode: no obvious query pattern) become micro contexts within parent pages unless they serve a strategic role (e.g., entity disambiguation, internal linking hub). Document the disposition.

**5.4 Off-Topic Expansion Check**
For every Outer Section topic, trace the connection path back to the Central Entity:
- 1 hop: directly supports Core → keep
- 2 hops: supports a topic that supports Core → keep with justification
- 3+ hops: potential scope creep → flag for user review

**5.5 siteFocusScore Heuristic**
Every topic in the map should plausibly reinforce the site's topical identity. If a topic would make a human reviewer question "why is this on this site?", flag it.

**5.6 Site-Type Watch-Out** *(v4.4)*
Run the cannibalization risk named for the declared site type in `references/site-type-playbooks.md` § 2.x as a targeted pass (e.g. Affiliate: "best X" vs "X vs Y" vs "X review" overlap; Ecommerce: category vs blog-guide on the same head; Local: near-duplicate service×geo doorway risk; Existing Expansion: new pages colliding with live ranking URLs). Resolve with the §1A decision tree.

**5.7 Orphan-Reference Check** *(v4.8)*
Every URL named in Internal Links / connection-logic columns must exist as a map row or be flagged `[REFERENCED — NOT MAPPED]` with a disposition. E-E-A-T pages (methodology/about/author) are required Core rows when the site makes trust claims; every Phase-1 spoke cluster's hub publishes no later than its spokes. Full procedure: `references/v48-additions.md` §F.

**Deliverable:** A cannibalization report showing: merged topics, micro-context reassignments, flagged scope-creep topics, orphan-reference dispositions *(v4.8)*, and the clean topic list.

> **⛳ CHECKPOINT 5:** User confirms the cleaned map. No topics with unresolved cannibalization or unjustified scope expansion proceed to the build phase.

### Phase 6: Build the Map

**Tier 1 output** (always produced):

Produce the Tier 1 Strategic Map table (Section, Sub-section, Raw Topic, Search Intent [now 5 types], Priority with reasoning, Node Type, Fan-Out Tag, AIO Risk Score, PoS *(v4.7 — when Launch Conditions apply)*, Bridge Tag *(v4.8)*, Notes).

Plus:
- **Key Findings from the Data** *(v4.8)* — the 5–7 insight narrative, placed before the map table
- **Reject List** *(v4.8)* — the named deliverable per the Tier 1 spec
- 5 Core Components summary
- Quality Nodes (2–5) identified with reasoning + fan-out trees
- Trending Nodes identified with reasoning + **lifecycle rule** *(v4.8)*: publish during the spike at a dateless URL → evergreen-ify post-spike → rolling sections state a committed cadence; sunset only when no evergreen reframe exists (`references/v48-additions.md` §E)
- Core ↔ Outer connection logic (which Outer sub-sections support which Core sub-sections)
- **Template-separation notes** *(v4.8)*: flag trust-differentiated page classes (e.g., safety reports vs scam investigations) for visually distinct templates; record in Notes (`references/v48-additions.md` §H)
- **Author-entity assignment** *(v4.6)* — one named author entity per Core/Outer sub-section (cluster). Record per cluster; concentration compounds per-author topical authority (Authority Signature). See Foundational Theory → Author Authority Signature and `references/author-cluster-assignment.md`.
- **Launch Conditions block** *(v4.7 — when applicable)* — restate the Checkpoint 1 declaration against the built map: launch breadth honored (NARROW-ROOT wave scoped to root taxonomy / WIDE-FIRST coverage present), launch URL budget met post-PoS, wave-1 scope (or subfolder-proof cluster) named, expansion-origin node identified. See `references/launch-conditions.md` §4, §7, §8.

> **GUARDRAIL (Google AI guide, May 2026):** Google confirmed query fan-out as the AI Mode
> retrieval mechanism, but warns that creating separate content for every query variation
> "primarily to manipulate rankings or generative AI responses" violates the scaled content
> abuse spam policy — which now explicitly applies to generative AI responses. Each fan-out
> branch URL must pass a standalone-value test: distinct intent, distinct deliverable,
> non-substitutable content. If two branches would substantially overlap, consolidate into
> sections of one page. Default bias: fewer, deeper pages.

**Tier 2 output** (if requested — adds publishing metadata):

For each topic, add: Title Tag, URL Slug, Meta Description, Image URL Slug, Image Alt Text, Internal Link Targets, Schema Type, **Content Format** *(v4.1)*. (Fan-Out Tag is a Tier 1 column, not Tier 2 — schema reconciled v4.9; the three Tier 2 statements in this file now agree.)

> Read `references/procedure-detailed.md` Steps 15–20 for methodology. Read `references/v41-additions.md` Sections G and A for Format and Fan-Out tag guidance.

**Tier 3 output** (if requested — adds production handoff):

- Entity Map with honest `[UNRESOLVED]` markers for any unverified field — include the per-cluster **Author Entity -> Person @id -> sameAs** so `schema-markup-generator` can emit the authorship attribution layer *(v4.6)*
- Publication plan (order, frequency, priority tiers) — **with velocity governance.** Match the publishing rate to the *site's own baseline and editorial capacity*, not an absolute number: an established property publishing steadily can sustain volume a new domain cannot. Jitter the cadence (avoid identical daily counts and same-day bursts), ramp new corpora gradually, and never dump a whole sprint in one spike. This is the planning-side control for the gate's R44 publish-velocity lens (`algorithmic-authorship-gate` BATCH): a velocity spike relative to baseline (≈10× historical) is a documented SpamBrain scaled-content-abuse signal, independent of per-article quality — and there is no AI-text ranking factor, so what's measured is *sameness/velocity*, not authorship. When a BATCH audit returns a low Fingerprint Diffusion Score driven by D4 (velocity), the fix lives here — throttle and jitter the schedule; it is not a content rewrite. Pair with `seo-blog-generator`'s Step 4 batch-variance directive (vary structure + title/meta across the sprint) so the same set is neither structurally nor temporally fingerprinted. *(v4.7)* For new/zero-history properties the plan also carries the **ranking-state KPI ladder** (`references/launch-conditions.md` §5): Phase A is measured on daily-impressions velocity with **no click-based edits**, cadence transitions are state-triggered (`semantic-content-network` SCN-SQ-07), and the launch wave runs `algorithmic-authorship-gate` NEW-DOMAIN profile + pre-publish BATCH FDS before day one.
- Schema.org implementation notes per page type → hand off to `schema-markup-generator` skill
- **llms.txt** *(v4.1)* — read Section D (non-Google LLMs only — Google officially ignores llms.txt per its May 2026 AI guide; produce for ChatGPT/Perplexity/Claude crawler ecosystems, mark as optional/low priority)
- **Maintenance KPI Dashboard** *(v4.1)* — read Section E
- **Share of Model seed query set** *(v4.1)* — read Section F
- **Retrieval Confidence Map** *(v4.4)* — read `references/site-type-playbooks.md` §1D. Rank candidate pages by likelihood of winning the AI citation (passage independence, extractability, corroboration, source authority). Front-load High-confidence Retrieval nodes in the Phase 13 content sequence.

> **⛳ CHECKPOINT 6:** User reviews the built map at the requested tier before optional brief generation.

### Phase 7: Content Briefs (Optional Handoff)

Content briefs are NOT produced inside topical-map-creation. Hand off to the `content-brief-generator` skill, which converts the topical map rows into standardized YAML briefs. The briefs are the input to `seo-blog-generator`.

### Phase 8: Maintenance *(v4.1)*

See `references/v41-additions.md` Section E for the Maintenance KPI Dashboard cadence (90-day refresh review, content decay detection, Trending Node sunset rules). *(v4.7)* New/zero-history properties run the **ranking-state KPI ladder** (`references/launch-conditions.md` §5) as the dashboard's leading section until Phase C (positive state) is reached: impressions velocity + LLM Citation Share as the two launch curves, CNI/DNI ratio as the quality-doubt tripwire, then the standard Section E dashboard takes over. *(v4.8)* Before sunsetting any Trending Node, apply the lifecycle rule from Phase 6: evergreen-ify (dateless URL, post-spike content update, reframe as reference) is the default disposition; sunset only when no evergreen reframe exists.

### Phase 9: PM Content Plan (Tier 4 — On Request)

> Read `references/pm-content-plan-spec.md` before generating.

**Trigger:** User explicitly requests a content plan, PM handoff, sprint plan, or writer assignments. This phase is NEVER auto-triggered — it runs only on request.

**Input required:** A completed Tier 1 Strategic Map at minimum. If Tier 2/3 are available, the output is richer (title tags, internal link targets, publication plan inform sprint logic).

**Process:**
1. Read `references/pm-content-plan-spec.md` in full
2. Analyze the topical map for dependency chains (which pages link to which)
3. Assign articles to sprints using the dependency-first logic
4. Score difficulty for each article using the 5-factor rubric
5. Generate plain-English writer briefs for every article
6. Populate the Writer Guide with site-specific content
7. Build the XLSX workbook with all 6 sheets
8. Validate formulas with `scripts/recalc.py`
9. Present the file

**Deliverable:** `[site-name]-content-plan.xlsx`

> **⛳ CHECKPOINT 9:** User reviews and approves the content plan before distributing to the PM/writers.

---

## OUTPUT FORMATS

### Excel (XLSX) Format

Workbook with sheets organized by tier:

**Tier 1 sheets:**
1. **Overview:** Source Context, Central Entity, Central Search Intent, Core vs Outer counts, total topics, mode declaration, **Key Findings from the Data** *(v4.8)*
2. **Strategic Map:** Core and Outer topics with Tier 1 columns (including AIO Risk Score and Bridge Tag)
3. **Reject List** *(v4.8)*: rejected topic categories → example queries with volume → one-sentence topical-border reason each

**Tier 2 adds:**
4. **Publishing Metadata:** Title tags, URLs, meta descriptions, image slugs/alts, internal links, schema types, Content Format

**Tier 3 adds:**
5. **Entity Map:** URL → Primary Entity → Wikidata Q-ID (or `[UNRESOLVED]`) → Schema.org Type → sameAs (or `[UNRESOLVED]`) → **Author Entity → Person @id** *(v4.6)*
6. **Publication Plan:** Order, frequency, priority tiers
7. **Quality & Trending Nodes:** Identification, connection logic, fan-out trees, and Trending Node lifecycle dispositions *(v4.8)*
8. **llms.txt:** Plaintext sheet formatted as llms.txt content (non-Google LLMs only — Google officially ignores llms.txt per its May 2026 AI guide; produce for ChatGPT/Perplexity/Claude crawler ecosystems, mark as optional/low priority)
9. **Maintenance KPI Dashboard:** Cadence table + KPI tracker

**Tier 4 — PM Content Plan (separate XLSX workbook):**

See `references/pm-content-plan-spec.md` for the 6-sheet specification.

### Markdown Format

Structured document with:
- Header section (Source Context, Central Entity, mode, tier)
- Key Findings from the Data — 5–7 insights before the map *(v4.8)*
- Core Section topics organized by sub-section (or by journey stage, if two-phase intent *(v4.8)*)
- Outer Section topics organized by sub-section
- Reject List section with per-category reasons *(v4.8)*
- Quality/Trending Nodes list with fan-out trees
- AIO Risk Score column included in topic tables *(v4.3)*
- Author-entity per cluster + Entity Map author attribution *(v4.6, Tier 3)*
- Publication strategy notes (Tier 3 only)
- Cannibalization review summary
- llms.txt block (Tier 3 only; non-Google LLMs only — Google officially ignores llms.txt per its May 2026 AI guide; produce for ChatGPT/Perplexity/Claude crawler ecosystems, mark as optional/low priority)

---

## QUALITY CHECKLIST

Before delivering, verify each item and note the evidence. Do not check a box without stating what satisfies it.

**Foundation:**
- [ ] All 5 Core Components explicitly defined → cite Phase 2 output
- [ ] Core topics directly serve Central Entity + Central Search Intent → cite connection logic
- [ ] Outer topics support Core without being off-topic → cite Phase 5.4 review
- [ ] Every topic plausibly reinforces topical identity → cite Phase 5.5 review

**Map Structure:**
- [ ] Quality Nodes (2–5) identified with reasoning → cite Phase 6 output
- [ ] Trending Nodes identified with Core connections → cite Phase 6 output
- [ ] Tier 2 (if produced): Title Tags follow 4 methodologies → cite examples
- [ ] Tier 2 (if produced): URL slugs are hierarchical with no word repetition
- [ ] Tier 2 (if produced): Internal linking follows Root → Seed → Node flow
- [ ] Tier 2 internal link targets + Publication Plan → handoff to `semantic-content-network` ARCHITECT to build and validate the realized link graph (contextual bridges, click-depth, topical PageRank flow, anchor distribution, publication sequence)
- [ ] Tier 2 (if produced): Content Format assigned per topic → cite Section G
- [ ] Outer → Core linking verified

**v4.1 AI Mode + GEO:**
- [ ] Query Fan-Out trees produced for all Quality Nodes → cite Step 8.7 output; every branch has a mapped URL or flagged gap; every branch URL passes the standalone-value test (distinct intent, distinct deliverable, non-substitutable — see Phase 6 GUARDRAIL on scaled content abuse)
- [ ] Generative Intent (GEN) classified → all GEN-intent topics identified and tagged; read Section B to confirm classification logic
- [ ] GEN-intent pages flagged for Passage Independence compliance → cite Section C; at minimum Quality Nodes verified
- [ ] llms.txt produced (Tier 3) → Core, Supporting, Reference Data, and Exclusion sections populated; honesty note included; deliverable labeled "non-Google LLMs only — Google officially ignores llms.txt per its May 2026 AI guide" and marked optional/low priority
- [ ] Maintenance KPI Dashboard produced (Tier 3) → all 6 KPIs have baseline + target + measurement method
- [ ] Share of Model seed query set defined (Tier 3) → 30–50 queries from Core section documented; read Section F

**v4.3 AIO Risk:**
- [ ] AIO Risk Score assigned per topic → cite `references/aio-risk-score.md` rubric

**v4.7 Launch Conditions (New Build / zero-history only):**
- [ ] BQA state declared with evidence; launch breadth (NARROW-ROOT / WIDE-FIRST) follows the §2 table → cite Checkpoint 1 block
- [ ] PoS applied per attribute; every `segment` names its host page; launch URL budget stated and met → cite Phase 4 step 10 output
- [ ] Ranking-state KPI ladder in the deliverable; 10K/day trigger labeled as Koray heuristic (never a confirmed threshold) → cite §5 honesty rule
- [ ] Day-one baselines specified: GSC impressions + LLM Citation Share → cite Tier 3 / Phase 8 note
- [ ] Gate route stated: AAG NEW-DOMAIN profile + pre-launch BATCH FDS → cite §6 handoffs
- [ ] Expansion origin (node or subfolder-proof cluster) named → cite §7
- [ ] High/Critical-risk topics have a documented mitigation strategy
- [ ] Quality Nodes ≤ Medium AIO Risk OR have aggressive mitigation plan

**v4.4 Site-Type + SERP Logic:**
- [ ] Site Type declared at Checkpoint 1 and matching playbook applied → cite `references/site-type-playbooks.md` § 2.x
- [ ] SERP-Overlap Decision Tree applied to every cluster → each pair classified same/partial/distinct with a cited overlap (Tool-Assisted) or `[ESTIMATED]` reason (Manual); no unmeasured percentages
- [ ] Winning Page Type assigned per cluster → feeds Tier-2 Content Format
- [ ] Node Function tagged in Notes → mix sanity-checked against the playbook (not 90% Commercial, not zero Retrieval)
- [ ] Site-type cannibalization watch-out run in Phase 5.6
- [ ] Retrieval Confidence Map produced (Tier 3) → High-confidence Retrieval nodes front-loaded in sequence

**v4.8 Deliverable Upgrades:**
- [ ] Key Findings narrative (5–7 insights) placed before the map table → covers noise share, biggest gap, bridge cluster, momentum engine, moat asset
- [ ] Reject List shipped as a named deliverable → every category has example queries + a topical-border reason
- [ ] Journey-stage decision documented in Phase 2 → single-phase or two-phase intent, with reasoning; two-phase maps organize Core by stage
- [ ] Bridge Cluster tagged and priority-weighted → bridge logic stated in Key Findings
- [ ] Trending Nodes have lifecycle dispositions → dateless URL + evergreen-ify plan, or justified sunset; rolling sections state a cadence
- [ ] Orphan-reference check passed (Phase 5.7) → every internally-referenced URL is a map row or flagged with disposition; E-E-A-T pages (methodology/about/author) mapped when trust claims are made; Phase-1 spokes have a hub
- [ ] Cross-source volume verification done (Tool-Assisted/Audit) → 8–12 keywords spot-checked; cluster-inflated, declining, and single-source figures flagged per Honesty Rule 9
- [ ] Template-separation flags recorded for trust-differentiated page classes

**Integrity:**
- [ ] RPP filtering applied with stated reasoning → cite Phase 4 output
- [ ] Cannibalization review completed → cite Phase 5 report
- [ ] Zero-demand topics disposed as micro contexts or justified as standalone
- [ ] No fabricated metrics, Q-IDs, or sameAs URLs → all unverified fields marked `[UNRESOLVED]`
- [ ] Mode declaration stated and honored throughout

**Heuristic Signals (Tier 2+):**
- [ ] Schema type assigned per page type (Tier 2+) → handoff to `schema-markup-generator` for JSON-LD
- [ ] Entity Map fields honestly populated — `[UNRESOLVED]` where needed (Tier 3)
- [ ] AI Overview optimization notes included where applicable (directional, not prescriptive)

**Tier 4 (PM Content Plan):**

See full Tier 4 checklist in `references/pm-content-plan-spec.md` § Quality Checklist.

> For the full extended checklist including DataForSEO validation, visual semantics, and topic share measurement, see `references/supplementary.md` sections S21–S26. For v4.1 feature specs, see `references/v41-additions.md`. For AIO Risk Score detail, see `references/aio-risk-score.md`.

---

## GOOGLE API LEAK SIGNALS (Directional Heuristics)

The following signals were identified in the 2024 Google Content Warehouse API documentation leak. They describe internal data structures that **likely influence** ranking, but their exact weighting, implementation status, and interaction effects are not publicly confirmed. Treat as directional heuristics for design decisions, not as confirmed ranking factors.

| Signal | Directional Implication for Topical Maps |
|--------|------------------------------------------|
| `siteFocusScore` | Suggests every page should reinforce topical identity — off-topic pages may dilute this |
| `siteRadius` | Suggests high topical drift may trigger penalties. Supports tight topical boundaries |
| `contentEffort` (0–127) | Suggests Google measures human involvement via LLM evaluation — design for demonstrated effort |
| `siteAuthority` / `Q*` | Suggests a composite quality score — likely rewards sustained quality over time |
| `NavBoost` | Suggests topicality + links + popularity + click history merge into a behavioral signal |
| `unicornClicks` | Suggests high-impact clicks from topic-expert users may carry more weight |
| `OriginalContentScore` | Suggests content uniqueness and originality are measured |
| `pandaDemotion` | Suggests site-wide demotion for thin/low-quality content persists as a rolling signal |

> For the full signal taxonomy, see `references/supplementary.md` section S21.

Also consider the standard audit framework: siteAuthority, contentEffort, rhubarb, clutterScore, siteQualityStddev, directFrac, spambrainLavc, NSR, CRAPS, anchorMismatch. Cross-reference against Google patents (Panda US9031929B1, Information Gain US11354342B2, AI Replacement US12536233B1) — noting that patents describe methods Google may or may not deploy in production.

<!-- 2026-06-07: aligned with Google AI optimization guide (May 2026) + Search Central changelog (FAQ rich result deprecation, spam scope on AI responses, preferred sources, llms.txt mythbust) -->
<!-- 2026-07-22 v4.8: Reject List + Key Findings first-class deliverables, journey-stage Core organization (Phase 2.5), Bridge Cluster tag (Phase 4.11), Trending Node lifecycle rule, orphan-reference QA (Phase 5.7), cross-source volume verification (Honesty Rule 9), template-separation notes — adopted from the CryptoKiller.org external-map audit (Crypto Killer project). -->
<!-- 2026-06-08 v4.5: Tier 3 publication-plan velocity governance (cadence jitter, capacity-matching, new-corpus ramp) — planning-side control for algorithmic-authorship-gate v1.3 R44 publish-velocity lens / Fingerprint Diffusion Score D4. Pairs with seo-blog-generator v5.0 batch-variance directive. -->
