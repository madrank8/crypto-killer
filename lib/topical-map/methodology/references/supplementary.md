# Supplementary Topics — S1 through S28

Deeper-than-procedure reference for advanced topical-mapping work. Read individual sections as needed; this file is not meant to be read end-to-end.

Sections fall into 6 thematic clusters:

| Cluster | Sections | Topic |
|---------|----------|-------|
| Semantic mechanics | S1–S6 | N-grams, EAV, frame semantics, query networks, internal linking |
| Authorship & quality signals | S7–S12 | Algorithmic authorship, contentEffort, originality, visual semantics, micro-context, salience |
| Behavioral signals | S13–S17 | NavBoost, unicornClicks, click satisfaction, dwell, panda demotion |
| AI / GEO layer | S18–S22 | AI Overview, GEO, llms.txt mechanics, Share of Model, AI Mode fan-out |
| Authority architecture | S23–S26 | Ecosystem authority, perspectives & safe answers, brand-as-entity, E-E-A-T operationalization |
| Measurement & matrices | S27–S28 | Topical map matrix, topic share measurement |

> **Honesty note:** Where Google's internal mechanism is unverified, this file uses directional language ("suggests", "is consistent with"). API leak signals are framed as Koray and the SEO community interpret them, not as confirmed Google behavior.

---

## S1 — N-grams and Phrase Indexing

**Concept:** Search engines tokenize content into 1-grams (single words), 2-grams (word pairs), 3-grams (triples), and longer phrase units. Indexing and retrieval likely operate on these units, not just on full sentences.

**Topical-map implication:** When generating topics in Step 8.5 (predicate + attribute pairs), the resulting phrases should be natural 2-grams and 3-grams that users actually run as queries. Long, awkward phrases (e.g., "comprehensive guide to all aspects of sweepstakes casino bonus terms and conditions") fragment poorly into indexable n-grams; concise topical phrases (e.g., "sweepstakes casino bonus terms") match query patterns better.

**Practical rule:** A topic phrase should survive being decomposed into its component 2-grams and 3-grams without losing meaning. If decomposition produces nonsense fragments, the phrase is over-engineered.

**Cross-references:** S6 (internal linking anchor text relies on n-gram match), S16 (EAV phrase structure).

---

## S2 — Entity-Attribute-Value (EAV) Framework

**Concept:** Every page can be modeled as a set of EAV triples — Entity (the subject), Attribute (a property of the entity), Value (the specific instantiation). Search engines likely build internal representations along these lines via the Knowledge Graph + textual extraction.

**Examples:**

| Page topic | Entity | Attribute | Value |
|------------|--------|-----------|-------|
| "Stake.us welcome bonus" | Stake.us | welcome bonus | 250K Gold Coins + 25 Sweepstakes Coins |
| "Wegovy dosing schedule" | Wegovy | dosing schedule | weekly subcutaneous injection, titrated |
| "IC Markets minimum deposit" | IC Markets | minimum deposit | USD 200 |

**Topical-map implication:** Tier 2 of the map should expose the EAV structure per topic. The Tier 2 columns (Entity, attribute focus, value specificity) help downstream content briefs target the exact fact a search engine would want to extract.

**Practical rule:** If you cannot articulate a page's EAV triple in one line, the page topic is too vague. Either split into multiple EAV-distinct topics, or re-scope the topic to a single dominant triple.

**Cross-references:** S3 (frame semantics extends EAV with role-fillers), S4 (query networks chain EAV triples), Step 3.3 in `procedure-detailed.md`.

---

## S3 — Frame Semantics

**Concept:** Drawn from Charles Fillmore's frame semantics theory (and adapted by Koray to SEO), a frame is a conceptual scenario activated by certain words. Each frame has roles — slots that get filled by specific entities. Understanding a topic means understanding which frame it activates and what fills each slot.

**Example:** The frame "treatment_with_medication" has roles: patient (who), medication (what), prescriber (by whom), condition (for what), dose (how much), duration (how long), side effects (with what risk).

**Topical-map implication:** A comprehensive page targeting "Wegovy treatment" should explicitly cover each slot in the frame. A page that covers only "dose" and "side effects" omits "prescriber" and "duration" — the LLM/Knowledge Graph then can't extract a complete answer, and the page underperforms in both AI Overviews and ranking.

**Practical rule:** For Quality Nodes especially, write out the activated frame and its roles. Use the role list as the H2 skeleton. This is one of the strongest sources of "what to include" guidance.

**Cross-references:** S2 (EAV is the simpler underlying structure), S19 (passage independence requires frame completeness per passage).

---

## S4 — Query Networks

**Concept:** Real users don't run isolated queries — they run query sequences. A user investigating "sweepstakes casino" will likely also run "is sweepstakes casino legal", "best sweepstakes casino", "how to play sweepstakes casino", etc. The network of related queries forms a topical neighborhood Google likely models internally.

**Topical-map implication:** Topic generation (Step 8) should produce not just a flat list of topics but query networks — clusters of related queries that should be answered by a single page or by tightly linked pages.

**Practical rule:** In Tool-Assisted mode, use DataForSEO `dataforseo_labs/google/related_keywords/live` to surface the network around each seed. In Manual mode, brainstorm 5–10 queries a user might run before, during, and after the seed query. The network is the natural cluster boundary.

**Cross-references:** Step 8.7 (Query Fan-Out is the AI Mode version of this), Step 10 (SERP clustering operationalizes overlap detection).

---

## S5 — Predicates and Verb Relationships

**Concept:** Verbs (predicates) bind entities to their attributes and to other entities. Search engines likely use verb–entity co-occurrence patterns to understand topical context. "Treats", "prescribes", "is used for", "competes with", "is regulated by" each set up a different relationship pattern.

**Topical-map implication:** When generating topics (Step 8.5 / 8.6), the predicate matters as much as the entities. "Wegovy dosing" and "Wegovy prescribing" target related but distinct content — one is for patients (when to take), one is for prescribers (when to write the script).

**Practical rule:** List the top 8–15 predicates associated with the Central Entity during Phase 1 (Step 3.6). Each predicate × entity-attribute combination produces a distinct page candidate.

**Cross-references:** S2 (predicates connect E to A and A to V), S3 (frame roles are filled via predicates).

---

## S6 — Internal Linking Architecture

**Concept:** Internal links carry authority, topical context, and intent signals. Koray's framework: Root → Seed → Node. Root pages (homepage, top-level category) hold the most authority; they pass it to Seed pages (Quality Nodes); Seeds pass it to Nodes (every other page). All flows converge back toward Core.

**Three rules:**

1. **All links flow toward Core.** Outer Section pages link inward; Core pages rarely link outward.
2. **Anchor text matches the target's EAV triple, not the source's.** Link to "Stake.us welcome bonus" using the phrase "Stake.us welcome bonus" or close variant — not "click here" or "this guide".
3. **Quality Nodes link to every page in their fan-out tree.** If a Quality Node has 30 fan-out leaves, the Quality Node page contains 30 internal links to them (in-context, not in a separate "related" block).

**Common failure mode:** Site-wide "related articles" widgets that link by recency or category, not by topical relationship. These dilute the Root → Seed → Node flow.

**Practical rule:** For Tier 2 output, the Internal Link Targets column should list 5–15 specific target URLs per page, with anchor-text suggestions. The total internal-link graph should be inspectable as a directed graph; if there are disconnected components, those clusters are stranded.

**Cross-references:** Step 20 in `procedure-detailed.md`, S11 (micro-context behaves like a nested internal link).

---

## S7 — Algorithmic Authorship

**Concept:** Author identity, when consistently expressed across content, contributes to E-E-A-T signals. Algorithmic authorship is the practice of designing author entities so that their topical scope, credentials, publishing pattern, and external presence are all internally consistent and externally verifiable.

**Elements that signal authorship:**

- **Bylined article + linked Author page** — the basic floor
- **Author bio with credentials** — degrees, certifications, affiliations
- **Author sameAs links** — Wikipedia, LinkedIn, ORCID, professional bodies
- **Author's published topical scope** — does the author stick to a coherent topical territory?
- **External co-references** — citations of the author by other authoritative sites
- **Schema.org Person markup** with `knowsAbout` populated

**Topical-map implication:** Tier 3 should assign an author to each page (or at least each section). Authors should have coherent topical scopes; "Editorial Team" as author is weaker than a named expert. For YMYL niches, each Quality Node should be either authored or reviewed by a credentialed individual.

**Cross-references:** S8 (contentEffort signals overlap with authorship perception), `schema-markup-generator` skill § Person schema, `geo-aeo-layer` skill § author signals in AEO.

---

## S8 - contentEffort

**Concept:** Per the 2024 Google API leak, `contentEffort` is an attribute in the `QualityNsrPQData` module, described in the leaked documentation as an "LLM-based effort estimation for article pages." It is Google's apparent attempt to score how much human effort went into a page.

**Two cautions the leak does NOT support (despite wide community repetition):**

1. There is no confirmed numeric range for `contentEffort`. The 0–127 scale that often gets attached to it actually belongs to different attributes (`uacSpamScore`, and `OriginalContentScore` for "little content"); it was imported onto `contentEffort` by mistake. Treat `contentEffort` as an ordinal effort estimate with no published bounds.
2. The leak says nothing about Google taking a screenshot of the page and sending it to an LLM to score design or layout. That mechanic is community extrapolation, not leak text. Where layout matters, anchor to confirmed sources instead (QRG Main-Content / Supplementary-Content / Ads framework; the 2012 Page Layout Algorithm, a.k.a. "Top Heavy," which demotes ad-heavy above-the-fold layouts).

**Scope note:** the definition is explicitly for "article pages," so `contentEffort` may not apply to commercial or tool pages at all.

The exact features it measures are not confirmed; plausible inputs include depth of analysis, original research, unique data, structural complexity, citation density, and original imagery.

**Topical-map implication:** Quality Nodes should target high `contentEffort` perception. This affects topic-level decisions — a topic that can only be addressed superficially is a poor Quality Node candidate; reassign it as a supporting Node.

**Practical heuristics for high contentEffort perception:**

- Multiple distinct sections that each present genuine information
- Citations to primary sources, not just other content sites
- Original data, charts, or comparisons (vs. summarizing what's freely available)
- Multimedia: original images, diagrams, embedded tools
- Length proportional to topic depth (not bloat; bloat is detected separately)
- Coherent voice and consistent terminology

**Cross-references:** S9 (originality is one input), S25 (proprietary asset inventory tracks contentEffort-generating assets across a site), `commodity-detection-gate` skill.

---

## S9 — Originality (OriginalContentScore)

**Concept:** Per the API leak, `OriginalContentScore` likely measures how distinct a page's content is from the corpus of indexed pages. High overlap with existing content depresses the score; novel content, original framing, and primary research lift it.

**Topical-map implication:** Topic selection should prefer topics where the site can produce genuinely original content. If 50 sites have already covered "what is a sweepstakes casino" thoroughly, the 51st site adds nothing — unless it brings a novel angle (first-hand testing data, state-specific legality detail, original screenshots, expert commentary).

**Practical rule:** During Phase 4 filtering, flag topics where the SERP top-10 already saturates the obvious angles. These topics need either (a) a documented differentiation angle before they enter the map, or (b) demotion to Outer Section / micro-context.

**Cross-references:** S8 (contentEffort signals can reinforce originality), S25 (proprietary asset inventory), the `commodity-detection-gate` skill.

---

## S10 — Visual Semantics

**Concept:** Images carry topical signals: filename, alt text, surrounding text, EXIF data, and visual content itself (Google likely uses image classifiers). A page's visual layer either reinforces or contradicts its textual topic.

**Topical-map implication:** Tier 2 outputs include Image URL Slug and Image Alt Text columns. These aren't decoration — they're the visual EAV for the page. An article about "Wegovy dosing schedule" needs an image showing a dose schedule, named and tagged accordingly. A stock photo of a doctor's office named `IMG_4823.jpg` adds nothing semantically.

**Visual semantic rules:**

1. **Filename = topic phrase**, hyphenated, lowercase, no stop words ("wegovy-dose-titration-schedule.png")
2. **Alt text = literal description + entity context** ("Wegovy dose titration schedule chart showing 0.25mg starting dose escalating to 2.4mg over 17 weeks")
3. **Image surroundings must align** — the paragraph before and after the image should textually reference what the image shows
4. **Originality matters** — original screenshots, diagrams, and photos outperform stock or AI-generated decorative imagery

**Cross-references:** `article-visual-generator` skill (operationalizes this), Step 18–19 in `procedure-detailed.md`.

---

## S10b - Layout Semantics & Page Function

**Concept (Koray, SERPConf Vienna 2025, expanded at Baltic-Nordic Vilnius 2026):** Google scores not only a document's text but its rendered layout, and reads different components with different algorithms. Layout is treated as a signal of two things: the human effort behind the page (see S8) and the page's function, meaning what the page is *for*. Text-level chunking and design-level structure must align, so the visual container (section, tab, card) and the content block it holds represent the same topical unit.

**Evidence tiers (label the claim before relying on it):**

- **Confirmed, Google source. Centerpiece annotation.** Martin Splitt (Oct 2021) stated Google has a centerpiece annotation plus "a few other annotations," reading semantic content and "potentially the layout tree" to separate main content from boilerplate and weight blocks by relevance. Off-topic sections are down-weighted. The "20+ annotation types" figure circulated in the community is not Splitt's number.
- **Confirmed, Google source. Layout as quality.** QRG Main-Content / Supplementary-Content / Ads framework, and the 2012 Page Layout Algorithm ("Top Heavy"), which demotes ad-heavy above-the-fold layouts.
- **Inferred, leak. Effort.** `contentEffort` (S8) plausibly rewards effortful, original construction. No screenshot or design-scoring mechanic appears in the leak.
- **Patent-grounded. Card grammar.** US 10,824,630 ("Search and retrieval of structured information cards," Najork and Bendersky et al., granted 2020) describes a card-trigger-term-identification unit that learns the vocabulary activating a structured card. Important: the patent governs SERP card *display* triggered by queries, not on-page classification of a publisher's page. Operationalized in `schema-markup-generator`.
- **Koray model, test before asserting as Google-confirmed.** (a) Graded action axis: committal actions (book, reserve, compare) outperform weak "click-and-go" actions when theme-aligned. (b) Per-page function or card classification of publisher pages. (c) Clustering of site *designs* into expert vs apprentice. No primary source confirms (b) or (c).

**Topical-map implications:**

1. Assign each page one dominant function (informational answer-block, tool, comparison, or product/CTA) and make that function element the centerpiece, in the first viewport.
2. Modality is per-section, not per-page. Mark each section's required register (factual vs opinionated) and format (structured vs prose). Operationalized in `algorithmic-authorship-gate` (selector) and `semantic-content-engine` (write-time tagging).
3. "Compare" is dual-class: both a perspective and a committal action, which is the structural reason comparison pages are resilient. Prefer comparison-card structure on commercial pages over bare outbound CTAs.

**Cross-references:** `retrieval-arbitration-os` (Layer 0 annotation-eligibility), `clutter-score-gate` (action-quality scoring), `schema-markup-generator` (card trigger-term grammar), `content-brief-generator` (per-section Pixel/Letter/Byte field), `semantic-content-network` (outer-section activation).

---

## S11 — Micro-Context

**Concept:** Not every topic needs its own page. Some topics are best addressed as a paragraph or section inside a parent page — the "micro-context" treatment. Koray's framework: topics with zero or near-zero search demand, but real topical relevance, become micro-contexts.

**Decision rule:**

| Topic has measurable demand? | Topic has topical relevance? | Treatment |
|------------------------------|-------------------------------|-----------|
| Yes | Yes | Standalone page |
| No | Yes (supports a real page) | Micro-context (paragraph/section) |
| Yes | No (off-topic) | Don't cover |
| No | No | Don't cover |

**Topical-map implication:** Phase 5.3 in the procedure explicitly handles this. The topical map's Tier 1 should list micro-context candidates separately, mapped to their parent page. This prevents the common error of generating a thin page for every keyword.

**Practical rule:** A page with 5–15 well-integrated micro-contexts outperforms a cluster of 5–15 thin standalone pages on the same topics. The thin-cluster approach also risks pandaDemotion (S15).

**Cross-references:** Phase 5.3 in SKILL.md, S15 (panda demotion mechanism).

---

## S12 — Salience

**Concept:** In a semantic triple (Subject–Predicate–Object), the subject position carries more weight than the object position. This shapes how content should foreground its key entities.

**Example:**

- Weaker: "Many users have positive experiences with Stake.us."
- Stronger: "Stake.us delivers fast cashouts and a clean Gold-Coin / Sweepstakes-Coin model."

The first sentence puts "users" in subject position; "Stake.us" is the object of "with". The second puts "Stake.us" in subject position and binds it to specific attributes via verbs.

**Topical-map implication:** Tier 2 title tags, meta descriptions, and H1 headings should put the primary entity in subject position whenever possible. The first paragraph of the body should do the same.

**Practical rule:** A quick salience audit: re-read the first 100 words of any draft article. Count how often the primary entity appears in subject position vs. object position. Aim for ≥60% subject position.

**Cross-references:** S2 (EAV ordering matters), Step 15 in `procedure-detailed.md` (title-tag methodologies).

---

## S13 — NavBoost

**Concept:** Per Google's DOJ trial disclosures and the API leak, NavBoost is a behavioral re-ranking system that adjusts rankings based on click and engagement data. Topicality × Links × Popularity × Click history merge into a behavioral signal that promotes or demotes pages relative to their initial score.

**Inputs (per leak interpretation):**

- Click-through rate vs. expected CTR for the SERP position
- Dwell time and bounce-back behavior
- Repeated searches for the same query (signaling unsatisfied users)
- Click distribution shape (does one URL dominate, or is it spread?)
- Long click vs. short click ratio

**Topical-map implication:** Topical authority alone isn't sufficient — pages must satisfy users when reached. This means topic selection should favor topics where the site can produce content that actually answers the query (Needs Met in QRG terms). Selecting topics outside the site's competence floor sets up NavBoost-driven demotion.

**Cross-references:** S14 (unicornClicks), S17 (click satisfaction), S22 (AI Mode behavioral signals may differ from NavBoost).

---

## S14 — unicornClicks

**Concept:** Per the API leak, `unicornClicks` likely identifies clicks from users who are themselves topical experts or high-quality information consumers. These clicks carry more weight than commodity clicks.

**Topical-map implication:** For YMYL and technical topics, the audience composition matters. A page that attracts and satisfies expert users (physicians for medical content, professional traders for forex content) earns a stronger behavioral signal than a page with the same total click volume from less-expert audiences.

**Practical rule:** Quality Node selection should favor topics where the site can attract expert-level engagement. Build pages that experts share with each other; commodity content rarely passes that bar.

**Cross-references:** S13 (NavBoost is the umbrella), S23 (expert ecosystem authority).

---

## S15 — pandaDemotion

**Concept:** Per the API leak, `pandaDemotion` likely persists as a rolling site-wide signal that demotes sites with concentrations of thin or low-quality content. This isn't fully transient — sites that accumulate thin pages can take months to recover even after cleanup.

**Topical-map implication:** Every page added to the map should be defensible on quality grounds. A topical map that lists 200 pages but 60 of them will be 300-word thin pages is a panda risk in waiting. Better to publish 80 strong pages than 200 mixed.

**Practical rule:** Phase 5.3 (zero-demand topic disposition) and Phase 5.5 (siteFocusScore) work together to prevent panda exposure. Be ruthless about converting thin candidates to micro-contexts.

**Cross-references:** S11 (micro-context disposition), S8 (contentEffort), `clutter-score-gate` skill (catches a related failure mode).

---

## S16 — Attribute Over Entity Stuffing

**Concept:** Koray's "Attributes > Entities" principle. Sites that win on topical authority do so by being deeply differentiated on attributes and values, not by stuffing many entities into shallow coverage. Listing every brand name in a niche doesn't beat covering one brand's attributes exhaustively.

**Example for SweepDogs:**

- Weaker (entity-stuffed): a "best sweepstakes casinos" page that lists 30 casinos with one line each
- Stronger (attribute-deep): a "Stake.us review" page that covers welcome offer, Gold Coin / Sweepstakes Coin model, cashout speed, KYC strictness, game variety, support quality, and state availability in depth

**Topical-map implication:** Outer Section "best of" pages must be supported by deep Core Section single-entity reviews. A site with a strong "best of" page but thin review pages is structurally weak; the "best of" page can rank short-term but lacks the attribute depth to defend its position.

**Cross-references:** S2 (EAV), S9 (originality often comes from attribute depth), `clutter-score-gate` skill (specifically catches entity-stuffed listicles).

---

## S17 — Click Satisfaction (Long Click / Short Click)

**Concept:** A "long click" is when the user clicks a SERP result and doesn't return to the SERP for a meaningful interval — they got what they needed. A "short click" is when the user bounces back quickly — they didn't.

**Topical-map implication:** Topics where the user need is small (one fact) should produce short pages that answer the fact directly. Topics where the user need is large (e.g., a buying decision) should produce comprehensive pages. Mismatching format to need produces short clicks → behavioral demotion.

**Format-to-need mapping (also see S22, AI Mode):**

| User need | Right format | Wrong format |
|-----------|--------------|--------------|
| Quick fact | Short definitional page or featured snippet target | 3,000-word essay |
| Comparison | Comparison guide with table | List of separate reviews |
| Decision | Comprehensive review with verdict | Buyer's-guide article that doesn't recommend |
| How-to | Sequential steps with images | Conceptual essay |
| Investigation | Hub page linking to component pages | One massive page |

**Cross-references:** S13 (NavBoost), Step 19b (Content Format assignment in v4.1 Section G).

---

## S18 — AI Overview Mechanics

**Concept:** Google's AI Overviews surface a synthesized answer above the organic results for many queries. The mechanism: Google's AI summarizes content from multiple cited sources. Citation in an AI Overview is the new top-of-page real estate.

**Inclusion factors (per Seer Interactive's 2026 AIO research and Koray's framework — directional, not confirmed):**

- Extractive answer presence in the source page (a self-contained passage answering the question literally)
- Passage independence (the answer makes sense out of context — see S19)
- Source authority signals (E-E-A-T, knownPublisher, schema)
- Citation density in the page (sites that themselves cite primary sources are more likely to be cited)
- Recency and freshness signals
- Direct topical match between query and page focus

**Topical-map implication:** Topics with AI Overview presence in the SERP need pages designed for AI extractability, not just ranking. The AIO Risk Score column (`aio-risk-score.md`) operationalizes this.

**Cross-references:** S19 (passage independence), S22 (AI Mode is a deeper version), `geo-aeo-layer` skill, `aio-risk-score.md`.

---

## S19 — Passage Independence

**Concept:** A passage is "independent" if it makes complete sense when extracted from its surrounding article. AI Overviews, featured snippets, and direct-answer SERP features prefer independent passages.

**Test for passage independence:**

1. Take any single H2 section from your page
2. Read it as a standalone unit
3. Can a reader who hasn't read the preceding sections fully understand it?

If yes, the passage is independent. If no, rewrite to add minimal disambiguating context.

**Common dependency patterns to remove:**

- Pronouns referring backward without re-mentioning the entity ("It works because..." — what is "it"?)
- References to "the previous section" or "as discussed above"
- Implicit setup from the introduction that the passage assumes

**Topical-map implication:** GEN-intent topics (v4.1 Section B) and any topic with High/Critical AIO Risk Score must be planned for passage independence. The brief generator should mark passages that must be independent.

**Cross-references:** S18 (AIO mechanics), v4.1 Section C (Passage Independence spec).

---

## S20 — llms.txt Mechanics

**Concept:** Per the emerging `llms.txt` proposal (analogous to `robots.txt` for AI crawlers and inference), a `llms.txt` file at the domain root signals to AI engines what content is canonical, supplementary, or excluded. Adoption is not universal but is growing among AI search vendors.

**Structure (per the proposal):**

```
# Site Name

> Site summary

## Core Pages
- /important-page-1: brief description
- /important-page-2: brief description

## Supporting Pages
- /supporting-1: description

## Reference Data
- /api-docs/: technical reference

## Exclusions
- /draft/
- /test/
```

**Topical-map implication:** Tier 3 output should generate a draft `llms.txt` from the map. Core Section pages → Core Pages block. Outer Section → Supporting Pages. Reference data hubs (e.g., the SweepDogs 50-state legality tracker) → Reference Data. Pages in the cannibalization-merge queue → Exclusions until consolidated.

**Honesty note:** AI crawler compliance with `llms.txt` is voluntary and varies by vendor. Don't claim it will guarantee inclusion or exclusion; treat it as one signal among many.

**Cross-references:** v4.1 Section D (llms.txt spec), `geo-aeo-layer` skill § CONFIGURE mode.

---

## S21 — Google API Leak Signal Taxonomy

The 2024 Google Content Warehouse API documentation leak surfaced many internal data structures. Below is a consolidated taxonomy of signals relevant to topical-map design. All signals are interpretations of API documentation, not confirmed ranking behavior.

### Site-level signals

| Signal | Likely role |
|--------|-------------|
| `siteAuthority` | Composite quality score for the entire site |
| `siteFocusScore` | How tightly the site focuses on a single topic; suggests off-topic pages dilute |
| `siteRadius` | Distance metric — how far the site drifts from its core topic |
| `siteQualityStddev` | Variance in per-page quality across the site; high variance suggests inconsistent quality |
| `pandaDemotion` | Site-wide rolling demotion for thin/low-quality concentration |
| `spambrainLavc` | Likely related to spam classification |
| `NSR` (Neural Search Result) | Possibly a neural-quality score |
| `CRAPS` (Click-And-Result-Prediction Score) | Likely a click-prediction model output |
| `directFrac` | Likely a direct-traffic-to-search-traffic ratio (branded demand proxy) |

### Page-level signals

| Signal | Likely role |
|--------|-------------|
| `contentEffort` | LLM-based effort estimation for article pages; no confirmed numeric range |
| `OriginalContentScore` | Originality vs. corpus |
| `rhubarb` | Possibly an off-topic detection signal |
| `clutterScore` | Likely detects clutter / low signal-to-noise pages |
| `anchorMismatch` | Detects when anchor text and target content don't match |

### Behavioral signals

| Signal | Likely role |
|--------|-------------|
| `NavBoost` | Click + engagement re-ranking system |
| `unicornClicks` | Expert-user click weighting |

### Entity signals

| Signal | Likely role |
|--------|-------------|
| `knownPublisher` | Whether the publisher entity is established in the Knowledge Graph |
| `knownAuthor` | Whether the author entity is established |
| `entitySalience` | Per-page entity salience (which entity dominates the page) |

**Topical-map implication:** The map design should optimize for the signals listed above as a system, not individually. Specifically:

- Tight `siteFocusScore` + low `siteRadius` → focused topical map; don't sprawl into Outer Section beyond 2 hops
- High `contentEffort` → invest in Quality Nodes, not in commodity pages
- Strong `entitySalience` per page → each page targets one dominant EAV (see S2)
- Avoid `pandaDemotion` triggers → use micro-context (S11) instead of thin pages

**Cross-references:** S8, S9, S11, S13, S14, S15. The standard Madrank audit framework references these signals.

---

## S22 — AI Mode and Generative Search

**Concept:** Google's AI Mode (and the broader generative search trend across Perplexity, ChatGPT Search, Claude Web Search, Gemini) reorganizes the search experience around AI-synthesized answers with citations. The user query is "fanned out" into sub-queries; multiple sources contribute to one synthesized answer.

**Differences from classic SERP-driven ranking:**

| Dimension | Classic search | AI Mode |
|-----------|---------------|---------|
| Output | Ranked URL list | Synthesized answer + citations |
| Inclusion | Top-10 position | Cited or not (binary) |
| User behavior | Click + dwell | Often no click — answer is consumed in-place |
| Optimization target | Position 1 | Citation in the answer |
| Behavioral feedback | Click + dwell signals | Citation reuse + user follow-up |

**Topical-map implication:** Map design must explicitly consider AI Mode coverage. Step 8.7 (Query Fan-Out, v4.1 Section A) targets this. The AIO Risk Score column (`aio-risk-score.md`) operationalizes per-topic exposure assessment. The Share of Model KPI (v4.1 Section F) measures citation share.

**Practical implications for content:**

- Lead with the extractive answer; develop nuance afterward (inverted-pyramid structure)
- Cite primary sources within content; AI engines reward sites that themselves cite well
- Maintain passage independence (S19)
- Use Schema.org markup for entities, facts, and citations
- Build entity sameAs networks (Wikipedia, Wikidata, professional bodies)

**Cross-references:** S18 (AI Overview), S19 (passage independence), S20 (llms.txt), `geo-aeo-layer` skill.

---

## S23 — Ecosystem Authority

**Concept:** A single site cannot build authority in isolation. Authority is reinforced (or contradicted) by the broader ecosystem in which the site sits: who cites the site, who the site cites, who the authors are connected to professionally, what social and academic networks reference the site.

**Topical-map implication:** Authority-building isn't just a content task — it's a positioning task. The topical map should include explicit Outer Section topics that hub into ecosystem relationships: industry events, regulatory bodies, professional organizations, primary-source repositories.

**Example for ttime.men (men's telehealth):**

- Hub: "Men's Telehealth Industry Resources" → links to FDA, AUA (American Urological Association), Endocrine Society guidelines, peer-reviewed primary sources, regulatory advisories
- This page builds external citation flows because it's the natural reference for people writing about the niche

**Practical rule:** Every Outer Section should include at least one ecosystem hub page that links outward to authoritative sources. These pages rarely rank high directly, but they earn the site mentions and backlinks that lift the entire map.

**Cross-references:** S25 (proprietary asset inventory partly serves this), `astroturf-serp-os` skill § Editorial/Regulatory layers, S24 (perspectives & safe answers).

---

## S24 — Perspectives and Safe Answers

**Concept:** For controversial, evolving, or contested topics, presenting a single perspective is risky on multiple axes: factual (perspectives shift), legal (regulatory exposure on YMYL), and AI Mode (engines preferentially cite sources that present balanced perspectives). The "safe answer" pattern explicitly acknowledges multiple viewpoints, primary-source evidence, and uncertainty bands.

**Pattern:**

1. State the question
2. Summarize the consensus position, if one exists
3. Note significant minority positions or recent dissent
4. Cite primary evidence supporting each position
5. State what is unresolved or contested
6. Provide the writer's judgment with explicit caveats

**Topical-map implication:** YMYL topics, regulatory topics, and emerging-evidence topics should be tagged for safe-answer treatment in Tier 2 content briefs. The format is more demanding than a single-perspective article and requires more research depth — factor this into difficulty scoring (Tier 4).

**Cross-references:** S22 (AI Mode preferentially cites balanced sources), `affiliate-compliance-*` skills (YMYL compliance overlaps), Phase 5 cannibalization review (safe-answer pages and opinion pages on the same topic are different intents).

---

## S25 — Proprietary Asset Inventory

**Concept:** Sites that win on long-term topical authority do so partly because they own assets competitors can't replicate: proprietary data, original research, exclusive interviews, in-house tooling, ongoing data feeds. The proprietary-asset-inventory practice catalogues these and threads them through the topical map.

**Examples:**

- SweepDogs: 50-state legality tracker with structured data feed (auto-updating)
- ttime.men: physician review process with named reviewers + their credentials
- BrokerScope: regulator-status block per broker, kept current
- CryptoKiller: scam_brands database with entity-type classification

**Topical-map implication:** Quality Nodes should explicitly leverage proprietary assets. If a Quality Node candidate doesn't have a proprietary asset hook, ask: can we build one? If not, the candidate is weaker.

**Cross-references:** S8 (contentEffort), S9 (originality), `commodity-detection-gate` skill, `proprietary-asset-inventory.md` (the cross-property tracking document, per Madrank memory).

---

## S26 — E-E-A-T Operationalization

**Concept:** Google's Search Quality Rater Guidelines describe E-E-A-T (Experience, Expertise, Authoritativeness, Trustworthiness) as a rater-applied evaluation framework. While not a single ranking signal, E-E-A-T informs many signals indirectly.

**Operationalizing per dimension:**

| Dimension | What it requires | Map implication |
|-----------|-------------------|-----------------|
| Experience | First-hand familiarity with the topic (used the product, lived the experience) | First-person framing, screenshots, dated session records |
| Expertise | Demonstrable subject-matter knowledge | Author credentials, citations, technical depth |
| Authoritativeness | Recognition from the broader ecosystem | Backlinks, mentions, sameAs network |
| Trustworthiness | Honest, accurate, transparent | Disclosures, source citations, error correction, contact info |

**Topical-map implication:** Every Quality Node should have a documented E-E-A-T support plan:
- Experience: first-hand session protocol (e.g., `firsthand-review-casino` skill for sweepstakes)
- Expertise: named author with credentials in the topic
- Authoritativeness: external citations or mentions (build via S23 ecosystem hubs)
- Trustworthiness: full disclosure, sourced claims, dated content

**Extended QRG references useful for map design:**

- Section 4.0 — Lowest rating (owner-benefit content that exploits users)
- Section 4.6.6 — Filler content (Nov 2024 update; targeted by `clutter-score-gate`)
- Section 5 — Page Quality rating
- Section 12 — Needs Met rating

**Cross-references:** `clutter-score-gate` skill (catches Section 4.6.6 violations), `firsthand-review-casino` skill (operationalizes Experience), `redteam-multi` skill (validates trustworthiness pre-publish).

---

## S27 — The Topical Map Matrix

**Concept:** A topical map is a 2D plane along the axes of breadth (number of topics covered) and depth (thoroughness per topic). Different sites occupy different positions on this plane. The "matrix" view helps a site know what trade-offs it's making.

```
                    DEPTH (per-page thoroughness)
                    LOW                  HIGH
                    ─────────────────────────────
                    │                    │
  HIGH              │  SHALLOW + BROAD   │  IDEAL    │
  BREADTH           │  (thin content     │  (depth × │
  (# of topics)     │   farm risk)       │   breadth)│
                    │                    │           │
                    ├────────────────────┼───────────┤
                    │                    │           │
  LOW               │  THIN NICHE        │  DEEP     │
  BREADTH           │  (no authority,    │  EXPERT   │
                    │   no traffic)      │  (defensible│
                    │                    │   but slow)│
                    │                    │           │
                    └────────────────────┴───────────┘
```

**Topical-map implication:** Position-aware planning:

- **Shallow + broad** is the trap — many sites land here trying to chase keywords. Panda risk (S15) and clutter risk (S8) are highest.
- **Deep expert** wins long-term but requires patience and resources. Best for niches with few authoritative competitors.
- **Ideal (depth × breadth)** is what mature topical maps achieve over time — but you don't start here.

**New site strategy:** Start in **Deep Expert** quadrant (narrow, deep). Expand outward as authority compounds.

**Established site strategy:** Audit current position. If shallow + broad, consolidate (Phase 5 cannibalization) before expanding further.

**Cross-references:** S15 (panda risk in shallow+broad), Phase 5 (cannibalization), v4.1 Phase 8 (Maintenance).

---

## S28 — Topic Share Measurement

**Concept:** Just as a brand has market share, a site has topic share — what percentage of available organic / AI-Mode visibility for its target topics does it capture? Measuring topic share is the long-term scoreboard for a topical map.

**Three measurement layers:**

### Layer 1 — Classic SERP Topic Share

For each topic in the map:

1. Identify the keyword cluster (Step 10 SERP clustering)
2. Sum the estimated traffic for the cluster (Tool-Assisted: DataForSEO `keywords_data`)
3. Calculate the site's share of cluster traffic (rank position × CTR × volume)
4. Aggregate across all clusters for total topic share

### Layer 2 — AI Overview Citation Share

For each query likely to trigger AI Overview:

1. Run the query in incognito (or via DataForSEO `ai_optimization/llm_mentions/live`)
2. Capture AI Overview citations
3. Calculate % of queries where the site is cited

### Layer 3 — Share of Model (v4.1)

Across multiple AI engines (ChatGPT, Gemini, Perplexity, Claude):

1. Define a seed query set (30–50 queries from Core section, per v4.1 Section F)
2. Run each query on each engine
3. Capture whether the site is mentioned, cited, or quoted
4. Compute Share of Model = (sites's mentions / total possible mentions) per engine

**Topical-map implication:** Topic share is the meta-KPI. Topical maps should target measurable topic share lifts, not raw keyword counts. A map that adds 50 pages but doesn't move topic share isn't working.

**Cross-references:** v4.1 Section F (Share of Model), Section E (Maintenance KPI Dashboard), `geo-aeo-layer` skill § MEASURE mode.

---

## Cross-reference index

| Section | Primary cluster | Most-linked from |
|---------|-----------------|-------------------|
| S1 N-grams | Semantic mechanics | S6, S16 |
| S2 EAV | Semantic mechanics | S3, S4, S12, S16 |
| S3 Frame semantics | Semantic mechanics | S2, S19 |
| S4 Query networks | Semantic mechanics | Step 8.7, S10 |
| S5 Predicates | Semantic mechanics | Step 8.5, S2 |
| S6 Internal linking | Semantic mechanics | Step 20, S11 |
| S7 Authorship | Authorship & quality | S8, schema-markup-generator |
| S8 contentEffort | Authorship & quality | S9, S25, commodity-detection-gate |
| S9 Originality | Authorship & quality | S8, S25 |
| S10 Visual semantics | Authorship & quality | Step 18-19, article-visual-generator |
| S11 Micro-context | Authorship & quality | Phase 5.3, S15 |
| S12 Salience | Authorship & quality | S2, Step 15 |
| S13 NavBoost | Behavioral | S14, S17, S22 |
| S14 unicornClicks | Behavioral | S13, S23 |
| S15 pandaDemotion | Behavioral | S11, S8, clutter-score-gate |
| S16 Attributes > Entities | Authorship & quality | S2, clutter-score-gate |
| S17 Click satisfaction | Behavioral | S13, Step 19b |
| S18 AI Overview | AI / GEO | S19, S22, aio-risk-score |
| S19 Passage independence | AI / GEO | S18, v4.1 Section C |
| S20 llms.txt | AI / GEO | v4.1 Section D, geo-aeo-layer |
| S21 Signal taxonomy | AI / GEO | All site/page/behavioral signals |
| S22 AI Mode | AI / GEO | S18, S19, S20, geo-aeo-layer |
| S23 Ecosystem authority | Authority architecture | S25, astroturf-serp-os |
| S24 Perspectives & safe answers | Authority architecture | S22, affiliate-compliance-* |
| S25 Proprietary assets | Authority architecture | S8, S9, commodity-detection-gate |
| S26 E-E-A-T | Authority architecture | clutter-score-gate, firsthand-review-casino, redteam-multi |
| S27 Topical map matrix | Measurement & matrices | S15, Phase 5, v4.1 Phase 8 |
| S28 Topic share | Measurement & matrices | v4.1 Section F, geo-aeo-layer |
