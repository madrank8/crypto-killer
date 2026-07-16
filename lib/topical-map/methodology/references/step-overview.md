# 23-Step Procedure Overview

Reference for the topical-map-creation skill. Read before or during execution for a bird's-eye view of the full procedure.

## 23-STEP PROCEDURE (Overview)

> For full detail on any step, read `references/procedure-detailed.md`.

### PHASE 1: RESEARCH & FOUNDATION (Steps 1–7)

| Step | Action | Key Output |
|------|--------|------------|
| 1 | Audience Research | Demographics, pain points, search behaviors, user journey stages |
| 2 | Define 5 Core Components | Source Context, Central Entity, Central Search Intent, Core/Outer sections |
| 3.1 | Knowledge Domains | ALL fields of knowledge touching the Central Entity |
| 3.2 | Contextual Domains & Layers | Broad areas + specific angles where entity operates |
| 3.3 | Query Semantics | Query patterns, EAV relationships, modifiers, query networks |
| 3.4 | Manual Research | Google SERPs, Trends, competitors, forums, SEO tools |
| 3.5 | Ontology | Entity types, attributes, relationships, hierarchy |
| 3.6 | Entity Elements | ALL word relations: hypernyms, hyponyms, meronyms, holonyms, synonyms, predicates, attributes |

### PHASE 2: TOPIC GENERATION (Step 8)

| Substep | Method |
|---------|--------|
| 8.1 | Competitor topical coverage analysis (requires tool access or user-provided data) |
| 8.2 | Token insertion methodology (systematic modifier combinations) |
| 8.3 | Database finding (keyword tools, autocomplete, academic databases) |
| 8.4 | Manual topic generation from ontology + entity elements |
| 8.5 | Predicate/verb + noun-attribute sequence gathering |
| 8.6 | Best noun-predicate relationship identification |
| **8.7** *(v4.1)* | **Query Fan-Out tree generation for all Quality Nodes and High-priority Core topics — read `references/v41-additions.md` Section A before executing. HIGHEST PRIORITY for Google AI Mode coverage.** |

**Mode note:** In Manual mode, substep 8.1 uses web_search to research competitor site structures. In Tool-Assisted mode, use Ahrefs `ranked_keywords` / DataForSEO `ranked_keywords/live`. If neither is available, document the gap and proceed with methods 8.2–8.6. **Step 8.7 is always required regardless of mode.**

### PHASE 3: FILTER, CLUSTER & PRIORITIZE (Steps 9–11)

| Step | Action |
|------|--------|
| 9 | Filter by RPP: Relevance (1–10) × Prominence (1–10) × LOG(Popularity+1) — OR qualitative tiers in Manual mode |
| 9b *(v4.1)* | Assign Search Intent — now 5 types: Informational / Commercial / Transactional / Navigational / **Generative (GEN)**. Read `references/v41-additions.md` Section B. Mark GEN-intent topics for Passage Independence compliance (Section C). |
| 10 | SERP-based clustering: ≥3 shared top-10 URLs = same cluster/page (Tool-Assisted only; estimated in Manual) |
| 11 | Balance Vastness (breadth) × Depth (detail) × Momentum (publishing speed) |

**Key decisions**: Topics WITH search demand → separate pages. Topics WITHOUT demand → micro contexts within existing pages.

### PHASE 4: BUILD THE MAP (Steps 12–20)

| Step | Action |
|------|--------|
| 12 | Raw Topical Map: Entity + Attribute pairs connected via Query Networks |
| 13 | Quality Nodes: 2–5 comprehensive pages linked from homepage |
| 14 | Trending Nodes: Currently popular topics connected back to Core |
| 15 | Title Tags: 4 methodologies (Tier 2 only) |
| 16 | URL Slugs: Hierarchical, no word repetition (Tier 2 only) |
| 17 | Meta Descriptions (Tier 2 only) |
| 18 | Image URL Slugs (Tier 2 only) |
| 19 | Image Alt Texts (Tier 2 only) |
| 19b *(v4.1)* | **Content Format assignment** per topic — read `references/v41-additions.md` Section G (Tier 2 only) |
| 20 | Connect Core ↔ Outer: Internal signals ALWAYS flow toward Core section |

### PHASE 5: PUBLICATION & CONTENT STRATEGY (Steps 21–23)

| Step | Action |
|------|--------|
| 21 | Publication frequency (Tier 3 only) |
| 22 | Document templates: Macro Context → Contextual Bridge → Micro Context |
| 23 | Content briefs (Tier 3 only, triggers blog generator pipeline) |
| 23b *(v4.1)* | **llms.txt generation** — read `references/v41-additions.md` Section D (Tier 3 only) |

### PHASE 6: GEO/AI MODE OPTIMIZATION (v4.1 NEW)

| Step | Action |
|------|--------|
| 24 | **Passage Independence audit** — for all GEN-intent and Quality Node pages, verify the 5 passage independence rules. Read `references/v41-additions.md` Section C. |
| 25 | **Fan-out coverage check** — confirm all fan-out branches from Step 8.7 are covered by published or planned URLs. Flag and fast-track any gaps. |
| 26 | **Share of Model baseline** — run 30–50 seed queries across 3 LLMs. Record SoM. Document in Maintenance KPI Dashboard. Read `references/v41-additions.md` Section F. |

### PHASE 7: GENERATE CONTENT BRIEFS (Optional — Step 23)

> Read `references/content-brief-spec.md` for the full brief format.

When the user wants to move from the topical map to content production:

1. **Select topics** for brief generation — by priority tier, section, or manual selection
2. **For each selected topic**, generate a YAML content brief following the spec
3. Add `content_format` and `passage_independence` fields from v4.1 (Sections G and C)
4. **Output the brief** in the standardized format
5. The user can then pass the brief to the `seo-blog-generator` skill

**Honesty requirement:** If competitor benchmark fields (DR, traffic) were not obtained via tools in this session, mark them `[NO DATA]` rather than inventing numbers.

### PHASE 8: MAINTENANCE PROTOCOL (v4.1 NEW — Tier 3 Deliverable)

> Read `references/v41-additions.md` Section E for full protocol.

When producing Tier 3 output, always include:
1. **Phase 8 maintenance cadence table** (Monthly / Quarterly / Bi-annually / Triggered)
2. **Maintenance KPI Dashboard** with baseline and target values
3. **Share of Model seed query set** (30–50 queries selected from Core section)

Phase 8 transforms the topical map from a static deliverable into a living system.

### PHASE 9: PM CONTENT PLAN (Tier 4 — On Request)

> Read `references/pm-content-plan-spec.md` before executing.

When the user requests a PM handoff / content plan / Tier 4 output:

**Step 27 — Sprint Assignment**
1. Identify all dependency targets: pages that other pages must link TO
2. Assign Sprint 1: Root pages, Quality Nodes, and pages with 3+ inbound internal link targets from the map
3. Assign Sprint 2: Remaining Core Section pages (High → Medium → Low)
4. Assign Sprint 3: Outer Section pages with 1-hop Core connection
5. Assign Sprint 4+: Remaining pages by priority
6. Resolve circular dependencies: mutual-link pairs go in the same sprint

**Step 28 — Article Assignment Table**
For each article in the map, generate:
1. **Title**: From Tier 2 title tag (simplified) or Tier 1 Raw Topic (expanded to natural language)
2. **What to write**: 2-3 sentence journalist-style briefing — NO SEO terms
3. **Content type**: Mapped from `content_format` using the PM-label table in `references/pm-content-plan-spec.md`
4. **Difficulty**: Scored using the 5-factor rubric (YMYL, research depth, entity density, compliance, original assets)
5. **Est. hours**: From difficulty × word count matrix
6. **Dependencies**: Cross-referenced from internal link targets

**Step 29 — Writer Briefs**
For each article, generate a full plain-English brief following the template in the spec:
1. "What to write" expanded to 2-3 paragraphs
2. Key points from entity-attribute pairs (rewritten as plain English)
3. Article structure from heading skeleton (H2s with plain-language descriptions)
4. Research tasks from Source Ledger seeds (rewritten as journalist research prompts)
5. Internal links with placement context
6. Image requirements in plain English
7. Compliance notes if applicable (YMYL, disclosures)

**Step 30 — Writer Guide**
Populate the site-specific Writer Guide using:
- Source Context from Phase 2 (site identity, audience, business model)
- Niche compliance requirements from relevant affiliate-compliance skills
- E-E-A-T requirements translated to plain-language quality standards

**Step 31 — XLSX Generation**
Build the workbook using openpyxl:
1. Create all 6 sheets with proper formatting
2. Add data validation dropdowns for Status columns
3. Add conditional formatting for status, priority, completion %
4. Add formulas for KPI Tracker (COUNTIF, SUM, AVERAGE)
5. Freeze header rows, set column widths, apply print layout
6. Run `scripts/recalc.py` to validate formulas
7. Deliver as `[site-name]-content-plan.xlsx`

> **⛳ CHECKPOINT 9**: User reviews the content plan. PM can adjust sprint assignments, writer count assumptions, and due dates before distributing to writers.

---
