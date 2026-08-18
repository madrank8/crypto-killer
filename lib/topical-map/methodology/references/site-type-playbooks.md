# Site-Type Playbooks + SERP-Overlap Decision Logic — Reference (v4.4)

This file adapts the topical map to the **kind of site** being mapped, and codifies four cross-cutting analyses the playbooks depend on. Read it in **Phase 1**, immediately after declaring Execution Mode and Output Tier, and keep it open through Phase 4.

> **Honesty rules for this file (inherit SKILL.md § HONESTY RULES):** Every SERP-overlap, winning-page-type, and retrieval-confidence judgment is **evidence-backed in Tool-Assisted mode** (cite the Ahrefs/DataForSEO call) and **`[ESTIMATED]` in Manual mode** (state the reasoning). A site type never licenses inventing metrics. These playbooks set *expectations and defaults*; they do not replace the cannibalization review (Phase 5) or the honesty markers.

---

## Why this exists

A topical map for a 6-page local plumber, a 40k-SKU store, and a sweepstakes affiliate are not the same artifact, even in the same niche. They differ in which **node functions** dominate, which **page types win** the SERP, how aggressively to chase **AI retrieval**, and where **cannibalization** bites. v4.3 and earlier declared an *execution* mode (Manual/Tool/Audit) but had no *site-type* lens. This file supplies it.

The playbooks do **not** change the 31-step procedure or the checkpoints. They bias the defaults inside it.

---

## Section 1 — Cross-cutting analyses (defined once, used by every playbook)

### 1A. SERP-Overlap Decision Tree

The single most common mapping error is treating two queries as one page (or one query as two pages) without checking what Google actually ranks. Before assigning any cluster, classify each candidate query *pair* (or query→existing-page) by overlap:

| Overlap class | Evidence (Tool-Assisted) | Signal (Manual `[ESTIMATED]`) | Decision |
|---|---|---|---|
| **Same intent** | ≥ ~60% top-10 URL overlap, same dominant page type, same SERP features | Same answer satisfies both; same entities; a searcher would not expect two different pages | **One page.** Target both queries from a single URL; the weaker query becomes an H2/section. |
| **Partial overlap** | ~30–60% URL overlap, mixed page types, shared head term + diverging modifiers | Related but a searcher might want a focused sub-answer | **Hub + spoke.** Parent hub covers the shared core; spokes target the diverging modifiers and link up. |
| **Distinct intent** | < ~30% URL overlap, different dominant page type, different SERP features/entities | Different answer, different journey stage, different page type expected | **Separate pages.** Independent URLs; cross-link only where contextually relevant. |

**Procedure (Tool-Assisted):** pull top-10 for each query (DataForSEO SERP or Ahrefs), compute URL-set overlap, note the dominant page type and SERP features. Cite the call. For large maps, sample representative pairs per sub-section rather than every pair — and flag the sampling in Phase 15 Validation Requirements (clustering confidence is only as good as retrieval coverage).

**Procedure (Manual):** infer overlap from semantic proximity + your knowledge of the SERP, label every decision `[ESTIMATED — no SERP data]`, and state the one-sentence reason. Never present an overlap percentage you did not measure.

This decision tree is the mechanism behind Phase 4 clustering and Phase 5.1 intent-overlap scanning. It replaces "cluster by what looks similar" with "cluster by what Google ranks the same way."

### 1B. Winning Page Type analysis

For each cluster, determine **which page type the SERP rewards** — not just which format you'd prefer to write. Google has usually already "voted" on the format.

Candidate page types: glossary/definition, pillar/ultimate guide, category/collection, comparison ("X vs Y"), listicle/best-of, review, calculator/tool, framework/methodology, how-to, local service+geo, product, FAQ, data/statistics, video/transcript.

- **Tool-Assisted:** read the dominant page type across the top 10 (e.g. "8/10 are comparison tables → comparison page wins"). Cite the SERP pull. If the SERP is mixed, note it — mixed SERPs often signal partial intent (→ hub+spoke).
- **Manual:** infer the winning type from intent + your SERP knowledge; label `[ESTIMATED]`.

The winning page type **feeds the Tier 2 Content Format column** and the Schema Type. If the SERP wins with a calculator and you publish a 2,000-word essay, the map is wrong regardless of how good the prose is.

### 1C. Node Function taxonomy (orthogonal to Quality/Trending/Standard)

The existing **Node Type** column (Quality / Trending / Standard) classifies a node by *strategic priority and timing* — keep it; it is core to Koray's method. Node **Function** is a second, orthogonal lens describing the *role a page plays in the authority graph*. A page has exactly one Node Type and one Node Function.

| Node Function | Role | Typical page types | Optimize for |
|---|---|---|---|
| **Authority** | Top-of-graph hubs that define the topic | pillar, ultimate guide, category hub, core service | coverage, internal-link gravity, `siteFocusScore` reinforcement |
| **Reinforcement** | Pages that corroborate and deepen the authority nodes | FAQ, glossary, methodology, statistics, supporting how-to | entity corroboration, semantic completeness |
| **Retrieval** | Pages built to be cited/extracted by AI systems and snippets | answer capsules, definitions, comparison tables, framework pages | passage independence, extractability, AIO citation hooks |
| **Entity** | Pages that reinforce a named entity (org, product, person, tool, brand) | about, product, author, tool, brand pages | `sameAs`, schema, entity disambiguation |
| **Commercial** | Pages that convert | money pages, best-of, comparison, product, lead-gen | buyer-stage match, CTA discipline, `clutterScore` control |

Node Function is recorded in the Tier 1 **Notes** column (e.g. `fn:Retrieval`) — it does **not** add a mandatory column, to keep the schema stable. Use it to sanity-check balance: a map that is 90% Commercial nodes will not build authority; a map with no Retrieval nodes will lose AI visibility. Each playbook below states its expected Node Function mix.

### 1D. Retrieval Confidence Map (Tier 3 output)

A Tier-3 deliverable that ranks pages by **likelihood of becoming the cited source** in AI Overviews / AI Mode / LLM answers. Complements (does not duplicate) the AIO Risk Score (which measures *exposure to displacement*) and Share of Model (which *measures* citation share after publish). Retrieval Confidence is a *pre-publish prediction* of which of your own pages will win the citation.

For each candidate page, score Low / Medium / High on:
1. **Passage independence** — does a standalone passage answer a fan-out sub-query without surrounding context? (ref: `v41-additions.md` § C)
2. **Extractability** — clean answer capsule, definition, or table near the top.
3. **Corroboration** — entities/claims that match the consensus across authoritative sources.
4. **Source authority** — is the property plausibly trusted for this claim (E-E-A-T, entity recognition)?

Output table: `| Page | Fan-Out branch served | Retrieval Confidence | Weakest factor | Fix |`. High-confidence Retrieval nodes are the ones worth front-loading in the content sequence (Phase 13). This is directional planning, not a forecast — label accordingly.

---

## Section 2 — The seven playbooks

Each playbook biases: **default mode**, **Node Function mix**, **winning-page-type patterns**, **AIO/retrieval posture**, **top cannibalization watch-out**, and **pipeline handoffs**. Confirm the playbook with the user at Checkpoint 1.

### 2.1 New Site Build
- **Use when:** site has little/no authority and few/no published pages.
- **Default mode:** Manual is acceptable to start; move to Tool-Assisted before committing the sequence.
- **Node mix:** establish 2–3 **Authority** hubs first, then **Reinforcement** spokes around them; defer broad **Commercial** expansion until the hub has coverage.
- **Winning page types:** pillar + tight supporting how-to/FAQ clusters; avoid thin best-of pages early (no authority to rank them, high `clutterScore` risk).
- **AIO/retrieval:** target low-competition **Retrieval** wedges — definitions, framework pages, narrow fan-out branches competitors ignore — to earn early citations before DR catches up.
- **Sequencing:** depth-first on one hub before breadth. Crawl efficiency and `Cost of Retrieval` matter most here.
- **Cannibalization watch-out:** over-expansion — publishing breadth before any hub is complete dilutes the new site's focus signal.
- **Handoffs:** `content-brief-generator` for the first hub cluster; `seo-blog-generator`; `classifier-os` after ~10 pages to confirm the topical identity landed.

### 2.2 Existing Site Expansion
- **Use when:** site already ranks; goal is to find gaps and strengthen weak nodes.
- **Default mode:** Tool-Assisted (you have GSC/Ahrefs history to mine).
- **Node mix:** identify under-reinforced **Authority** nodes and add **Reinforcement** + **Retrieval** spokes; add **Commercial** only where buyer-stage coverage is missing.
- **Winning page types:** driven by gap analysis — map existing URLs to clusters first, then fill holes.
- **AIO/retrieval:** prioritize fan-out branches where the site already ranks page-2/3 (cheapest citations to win).
- **Cannibalization watch-out:** the highest-risk playbook for cannibalization — new pages colliding with existing ranking URLs. Run Phase 5.1/5.2 against the *live* URL set, not just the new topics. Use the SERP-overlap tree against existing pages, not only candidate pairs.
- **Handoffs:** Audit Mode pass first if a map already exists; `classifier-os` to locate weak nodes.

### 2.3 Ecommerce Store
- **Use when:** catalog-driven site (categories, collections, products).
- **Default mode:** Tool-Assisted; needs product catalog + taxonomy as inputs.
- **Node mix:** **Commercial** (category/collection/product) as the spine, wrapped in **Reinforcement** buying guides and **Retrieval** comparison/spec content; **Entity** nodes for brands.
- **Winning page types:** category/collection for head terms, comparison and "best [category] for [use-case]" for mid-funnel, product for transactional, buying-guide for informational support. Confirm per cluster with the SERP — many commercial heads are won by *category* pages, not blog posts.
- **AIO/retrieval:** spec tables and comparison matrices are highly extractable; structure them as Retrieval nodes.
- **Cannibalization watch-out:** category vs. blog-guide targeting the same head term; faceted-navigation URLs competing with curated collections.
- **Handoffs:** `schema-markup-generator` (Product/Offer/AggregateRating); `clutter-score-gate` on every best-of/roundup.

### 2.4 Blog / Publisher Site
- **Use when:** monetized by ads/affiliate/subscription via content breadth and depth.
- **Default mode:** Tool-Assisted for scale; Manual acceptable for niche authority plays.
- **Node mix:** balanced **Authority** + **Reinforcement** + heavy **Retrieval**; **Commercial** where affiliate/display intent exists.
- **Winning page types:** glossary systems, framework/explainer pages, comparison hubs, data/statistics pages (citation magnets).
- **AIO/retrieval:** this is the playbook most exposed to AIO displacement — lean hard on Retrieval nodes, passage independence, and the Retrieval Confidence Map. Read `aio-risk-score.md` for every commercial/YMYL topic.
- **Cannibalization watch-out:** topic sprawl across many thin posts that should be one comprehensive page (partial-overlap → hub+spoke, not N posts).
- **Handoffs:** full pipeline; `geo-aeo-layer` across the map.

### 2.5 Local SEO
- **Use when:** service-area or storefront business.
- **Default mode:** Tool-Assisted; needs service list + target geos.
- **Node mix:** **Commercial** service+geo pages as the spine, **Entity** reinforcement (GBP, NAP, about), **Reinforcement** FAQs.
- **Winning page types:** service×location landing pages, "near me" intent pages, local FAQ. Separate geo-intent rather than stuffing one page (distinct intent per the SERP tree when local packs differ by city).
- **AIO/retrieval:** local packs and AIO both pull from entity/structured signals — prioritize NAP consistency and LocalBusiness schema over content volume.
- **Cannibalization watch-out:** doorway-page risk from near-duplicate service×geo pages with no local differentiation — each needs genuine local content or it collapses into one.
- **Handoffs:** `schema-markup-generator` (LocalBusiness, Service, geo); SpinokoGeo / state-augment patterns where applicable.

### 2.6 Affiliate SEO
- **Use when:** revenue is referral commission (incl. sweepstakes/casino/forex/telehealth verticals).
- **Default mode:** Tool-Assisted.
- **Node mix:** **Commercial** (best-of, comparison, "X vs Y") + **Retrieval** (recommendation capsules AI can cite) + **Reinforcement** (buyer guides) + **Entity** (brand/operator pages).
- **Winning page types:** best-of listicles, comparison matrices, single-product reviews, buyer guides — confirm which the SERP rewards per query (often comparison beats listicle for "vs" intent).
- **AIO/retrieval:** chase recommendation citations — structure recommendation capsules as Retrieval nodes so AI answers cite *your* pick.
- **Cannibalization watch-out:** "best X" vs "X vs Y" vs "X review" frequently overlap — run the SERP tree explicitly; merge where overlap is high. `clutterScore` discipline is mandatory on every roundup.
- **Compliance:** route through the relevant compliance skill (`affiliate-compliance-igaming` / `-forex` / `-telehealth`) — YMYL verticals force conservative AIO/E-E-A-T posture.
- **Handoffs:** `clutter-score-gate`, `firsthand-review-casino` (sweeps/casino), `astroturf-serp-os` for branded SERP plays, `pws-design-system`/`vas-apostacasa` for the relevant properties.

### 2.7 AI Visibility / GEO / AEO
- **Use when:** the explicit goal is AI citation/answer-engine visibility rather than (or alongside) classic rankings.
- **Default mode:** Tool-Assisted; pair with DataForSEO LLM Mentions endpoint where available.
- **Node mix:** **Retrieval** nodes dominate; **Entity** + **Authority** support corroboration.
- **Winning page types:** answer capsules, glossary nodes, framework pages, comparison structures, data pages — all built for extractability.
- **AIO/retrieval:** model query fan-out aggressively (`v41-additions.md` § A); one page or passage per fan-out branch; produce the Retrieval Confidence Map (§1D) as a primary deliverable; track Share of Model (§ F).
- **Cannibalization watch-out:** redundant capsules answering the same fan-out branch across pages — consolidate so one canonical passage owns each branch.
- **Handoffs:** `geo-aeo-layer`, `retrieval-arbitration-os` (will this page get cited), `schema-markup-generator`.

---

## How the playbook plugs into the workflow

| Workflow point | What the playbook changes |
|---|---|
| **Phase 1 (Checkpoint 1)** | Declare the **Site Type** alongside Mode/Tier/Scope; read this file. |
| **Phase 4 (cluster + prioritize)** | Apply the **SERP-Overlap Decision Tree** (§1A) and **Winning Page Type** (§1B); bias priority toward the playbook's dominant Node Functions. |
| **Phase 5 (cannibalization)** | Use the playbook's named watch-out as a targeted scan in addition to the standard 5.1–5.5. |
| **Phase 6 (build)** | Tag **Node Function** in Notes (§1C); set Tier-2 Content Format from the winning page type. |
| **Tier 3 output** | Produce the **Retrieval Confidence Map** (§1D). |
| **Handoff** | Route to the playbook's named downstream skills. |

This reference adds expectations, not steps. The checkpoints, honesty rules, and tier gating in SKILL.md remain authoritative.
