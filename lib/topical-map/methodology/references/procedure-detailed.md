# Procedure Detailed — 23-Step Topical Map Methodology

This is the deep-dive reference for the 23-step procedure described at high level in SKILL.md and `step-overview.md`. Read the relevant phase before executing it.

Source: Koray Tugberk Gubur's *Semantic SEO for Topical Authority* course (2023–2025) and supplementary teachings (2024–2026), as interpreted and operationalized by the Madrank/GODRANK methodology stack. Where Koray's framework is extended or adapted, those extensions are marked `[extension]`.

> **Honesty note:** This reference describes Koray's methodology as documented in his published materials. Where Google's exact behavior is unverified (e.g., specific signal weighting), the procedure uses directional language ("likely influences", "is associated with"). This reference does not claim Google internals.

---

## Phase 1: Research & Foundation (Steps 1–7)

### Step 1: Audience Research

**Purpose:** Identify the people who will read this content and the queries they will run. Everything downstream — topic generation, intent classification, content format — depends on getting this right.

**Inputs:**
- The site's monetization model and stated audience (from Source Context)
- ICP profile if available (use `icp-research` skill if not)
- Existing analytics if site is live (GSC, GA4, hotjar/clarity for engagement)

**Methodology:**

1. Define the **demographic skeleton** — age band, gender if persona-relevant, income tier, geographic concentration, language, devices.
2. Identify the **3–5 most common user journey stages** the audience moves through. For each stage, characterize the dominant search behavior (research / comparison / decision / retention).
3. Build the **pain-point inventory** — at minimum 8–12 specific situations the audience finds themselves in. Generic ("wants to save money") is wrong; specific ("comparing 3 GLP-1 telehealth providers at 11pm before a doctor visit") is right.
4. Identify the **anti-audience** — who must NOT find this content engaging. Captures filter signals that prevent topical drift downstream.

**Deliverable:** A 1–2 page audience brief with the four blocks above. This brief is consulted at Phase 2 (knowledge domains), Phase 4 (intent classification), and Phase 6 (Quality Node selection).

**Honesty rule:** If the user can't articulate the audience, do not invent one. Ask for an ICP, or run `icp-research` skill, before proceeding.

---

### Step 2: Define the 5 Core Components

Every topical map must explicitly state these five components before any topic generation:

1. **Source Context** — Website identity, monetization model, brand voice, regulatory tier (YMYL or not), geo focus.
2. **Central Entity** — The primary entity the site revolves around. Usually a noun phrase: "online sweepstakes casinos", "men's telehealth services", "forex brokers".
3. **Central Search Intent** — The primary action/outcome users seek when arriving at the site. Phrased as a verb-object: "find a casino to play at", "get a GLP-1 prescription online", "choose a forex broker".
4. **Core Section** — The set of topics directly related to Central Entity + Central Search Intent. This is where monetization happens. Authority signals flow here from the Outer Section.
5. **Outer Section** — Supporting topics that build breadth and transfer authority inward to Core. These topics should never overpower Core in publication volume or internal-link weight.

**Output format:** A 5-line block at the top of every topical map document. Example:

```
Source Context:        SweepDogs — sweepstakes casino affiliate / watchdog
Central Entity:        Sweepstakes casinos (US-legal, no-purchase social casino)
Central Search Intent: Find a legitimate sweepstakes casino to play at
Core Section:          Casino reviews + state legality + bonus comparisons
Outer Section:         How sweepstakes work, payment methods, regulatory background, RG
```

**Honesty rule:** If any of these five are unclear, stop. Resolve at the user level before continuing.

---

### Step 3: Knowledge Domains & Contextual Layers

**Step 3.1 — Knowledge Domains:** List ALL fields of knowledge that touch the Central Entity. For sweepstakes casinos, that's at minimum: probability theory, US gambling law, state-by-state sweepstakes legality, payment processing, responsible gaming policy, RNG technology, KYC/AML compliance, marketing affiliate disclosure, casino game theory, banking partnerships.

**Step 3.2 — Contextual Domains & Layers:** For each knowledge domain, identify the broad area and the specific angle the site operates in. Example: under "US gambling law", the broad area is federal law; the specific angle is state-by-state sweepstakes statutes.

**Step 3.3 — Query Semantics:** Document the query patterns the audience uses. For each pattern, identify:
- Entity-Attribute-Value (EAV) relationship being queried
- Modifiers commonly appended (best, free, US, 2026, near me)
- Query network (related queries that share the same EAV)

**Step 3.4 — Manual Research:** Run live SERPs for 10–20 seed queries. Google Trends comparisons. Competitor topical-coverage scan. Forum and Reddit subforum scan. SEO tool baseline (Ahrefs/DataForSEO for Tool-Assisted mode).

**Step 3.5 — Ontology:** Build the entity-type-and-attribute hierarchy. What is the Central Entity an instance of? What attributes does that type have? What relationships connect it to other entities?

**Step 3.6 — Entity Elements:** Catalog ALL word relations for the Central Entity:
- Hypernyms (broader category)
- Hyponyms (narrower instances)
- Meronyms (parts of)
- Holonyms (wholes containing)
- Synonyms (alternate names)
- Predicates (verbs commonly used with this entity)
- Attributes (properties this entity has)
- Co-occurring entities (entities frequently mentioned together)
- Functional roles (what this entity does)
- Contextual constraints (when this entity applies)

**Deliverable:** A structured Phase 1 output document with all six substeps populated. This becomes the input to Step 8 (topic generation).

> **⛳ CHECKPOINT 2 (per SKILL.md):** User reviews the foundation before topic generation begins. Errors here cascade through the entire map.

---

## Phase 2: Topic Generation (Step 8)

Topic generation runs in seven substeps. In Manual mode, substeps 8.2, 8.4, 8.5, 8.6 are fully available. Substep 8.1 uses `web_search` and produces partial output (gap-flagged). Substep 8.3 partially works through autocomplete/Trends. Substep 8.7 is always required for AI Mode coverage.

In Tool-Assisted mode, all seven substeps run with full data.

### Step 8.1 — Competitor Topical Coverage Analysis

**Tool-Assisted (Ahrefs/DataForSEO):**
- For 3–5 known competitors, pull `ranked_keywords` (Ahrefs) or `dataforseo_labs/ranked_keywords/live` (DataForSEO)
- Filter to keywords in positions 1–20 with measurable volume
- Cluster the keywords by topic (SERP overlap method or manual)
- Identify topics competitors cover that we don't
- Identify topics where competitors cover poorly (thin content, outdated, no E-E-A-T)

**Manual mode:**
- Visit 3–5 competitor sites manually
- Map their site structure (categories, hubs, supporting pages)
- Document the topical clusters they cover
- Note where their coverage is shallow or missing
- Mark output `[ESTIMATED — manual scan]`

**Output:** List of competitor topics. Tagged: "we cover", "we don't cover", "they cover poorly".

### Step 8.2 — Token Insertion Methodology

Systematic generation by combining the Central Entity with modifier tokens:

- **Geographic:** [country, state, city, region]
- **Temporal:** [year, season, recent, new, upcoming]
- **Demographic:** [for women, for beginners, for experts]
- **Comparative:** [vs X, alternatives to, best, cheapest]
- **Procedural:** [how to, guide to, tutorial]
- **Definitional:** [what is, definition, meaning]
- **Negative:** [avoid, dangers of, problems with]
- **Quantitative:** [top 10, best 5, list of]

For each modifier × Central Entity combination, ask: "Is this a query someone would actually run?" Discard nonsense pairs. Keep plausible ones.

### Step 8.3 — Database Finding

Pull topics from external databases:

- Google Autocomplete (seed-query expansion)
- Google "People Also Ask"
- Google "Related Searches"
- AnswerThePublic / AlsoAsked
- Reddit subreddit titles (especially top posts)
- Forum thread titles (Quora, niche forums)
- Academic database titles if the niche has one (PubMed for medical, SSRN for finance, etc.)

In Manual mode, this runs via `web_search` and is partial. Flag what's missing.

> **Tool-Assisted enhancement:** If `tavily-retrieval` skill is available, use it for fast multi-source surface scans. Note: tavily-retrieval is a separate skill — invoke it; do not duplicate its logic here.

### Step 8.4 — Manual Topic Generation from Ontology + Entity Elements

Walk through the Phase 1 ontology and entity elements. For each entity attribute identified in Step 3.6, ask: "Is there a topic worth a page about this attribute?"

This produces topics that don't show up in keyword tools because they're emergent — they describe attributes that exist conceptually but haven't been popular enough to register volume.

### Step 8.5 — Predicate/Verb + Noun-Attribute Sequence Gathering

Combine the predicates from Step 3.6 with the entity attributes. Example for "sweepstakes casino":

- Predicates: play at, sign up to, withdraw from, claim bonus from, redeem coins at
- Attributes: legality, bonus structure, game variety, payment speed, KYC strictness

Cross product → topics like "how to claim bonus from sweepstakes casino", "redeeming coins from a sweepstakes casino", "fastest-paying sweepstakes casinos".

### Step 8.6 — Best Noun-Predicate Relationship Identification

For each (predicate, noun) pair from Step 8.5, evaluate whether it represents a topic with:
- Identifiable search intent
- Plausible user need
- Differentiation from other topics in the list

Discard pairs that fail any of the three.

### Step 8.7 — Query Fan-Out *(v4.1)*

**Highest priority for Google AI Mode coverage.** Read `references/v41-additions.md` Section A before executing. Generate fan-out trees for all Quality Nodes and High-priority Core topics.

A fan-out tree for "GLP-1 telehealth" might branch:

```
GLP-1 telehealth
├── eligibility for GLP-1 prescriptions
│   ├── BMI requirements
│   ├── comorbidity requirements
│   └── insurance coverage
├── GLP-1 medication options
│   ├── semaglutide vs tirzepatide
│   ├── compounded vs branded
│   └── side effect profiles
├── cost of GLP-1 telehealth
│   ├── cash pay tiers
│   ├── insurance reimbursement
│   └── prescription savings programs
└── safety & monitoring
    ├── required lab work
    ├── follow-up schedule
    └── adverse event protocols
```

Every leaf in the tree either maps to an existing URL or becomes a documented gap for the topical map.

**Deliverable for Phase 2:** A raw, unfiltered master topic list with: topic phrase, generation method that produced it, EAV pair it represents.

> **⛳ CHECKPOINT 3:** User reviews the raw topic list. Adds, removes, flags priorities before filtering.

---

## Phase 3: Filter, Cluster & Prioritize (Steps 9–11)

### Step 9 — RPP Filtering

RPP = Relevance × Prominence × Popularity.

**Tool-Assisted mode (full formula):**

```
RPP = Relevance(1–10) × Prominence(1–10) × LOG(Popularity + 1)
```

- Relevance: how directly does this topic serve Central Entity + Central Search Intent? 10 = directly serves Core; 1 = distantly related.
- Prominence: how visible is this topic in the SERPs for the seed query? 10 = featured in top results / People Also Ask; 1 = no SERP presence.
- Popularity: monthly search volume (use logarithm to compress the long tail).

**Manual mode (qualitative tiers):**

Apply High / Medium / Low tiers with one-sentence reasoning per topic. Example:

- "GLP-1 prescription telehealth" → **High** because directly Core + clear commercial intent
- "history of weight loss medication" → **Medium** because supports Core via context but not transactional
- "Ozempic memes" → **Low** because off-Core and unlikely to convert

**Output:** All topics scored. Below-threshold topics dropped (or moved to micro-context candidacy in Step 9b/5.3).

### Step 9b — Assign Search Intent *(v4.1, 5-type)*

Intent classification — now 5 types after v4.1:

1. **Informational** — user wants to learn ("what is a sweepstakes casino")
2. **Commercial** — user is evaluating options ("best sweepstakes casinos")
3. **Transactional** — user is ready to act ("sign up sweepstakes casino")
4. **Navigational** — user wants a specific destination ("Stake.us sweepstakes")
5. **Generative (GEN)** *(v4.1)* — user wants an answer that an AI engine will likely synthesize from multiple sources ("what state can I play sweepstakes in")

Read `references/v41-additions.md` Section B for the full GEN classification rubric. Mark GEN-intent topics for Passage Independence compliance (Section C).

### Step 10 — SERP-Based Clustering

**Tool-Assisted only.** Two topics are in the same cluster (same page) if their top-10 SERPs share ≥ 3 URLs. Use Ahrefs `keywords_explorer` or DataForSEO `serp/organic/live` to fetch top-10 for each candidate keyword.

**Manual mode:** Cluster by semantic proximity. Label all clustering decisions `[ESTIMATED — no SERP data]`.

**Decision rules:**
- Topics with high SERP overlap → merge into one page targeting both
- Topics with low SERP overlap → separate pages
- Topics with NO measurable demand → micro-context candidates (Step 9b/5.3)

### Step 11 — Vastness × Depth × Momentum Balance

Three publishing axes:

- **Vastness:** breadth of topical coverage (how many topics)
- **Depth:** thoroughness per topic (how comprehensively each is treated)
- **Momentum:** publishing speed (how fast pages go live)

Most sites optimize one axis and starve the others. Balance:

| Site stage | Bias toward |
|------------|-------------|
| New site (0–10 pages) | Depth + Momentum on Core only |
| Growing (10–50 pages) | Vastness within Core, then Outer |
| Established (50+ pages) | Depth refresh of existing + selective Vastness |
| Mature (200+ pages) | Maintenance + Trending + selective new clusters |

**Output for Phase 3:** Filtered topic list with Section, Sub-section, Priority (with reasoning), Intent (5-type), merge/micro-context flags.

> **⛳ CHECKPOINT 4:** User reviews filtered and clustered map.

---

## Phase 4: Cannibalization + Focus Review (Step 11.5 / Phase 5 per SKILL.md)

This phase runs in 5 substeps and is MANDATORY before map finalization. SKILL.md has the full substep breakdown inline (Phase 5). This reference adds the deeper rationale:

**Why this phase is non-negotiable:** Cannibalization is the #1 cause of stuck rankings on otherwise well-built sites. Google's quality systems detect when multiple pages target identical intent + entity + attribute combinations and depress the entire cluster. Catching this before publication is 10× cheaper than detecting and consolidating after.

**Detection patterns to apply:**

| Pattern | Signal | Resolution |
|---------|--------|------------|
| Same entity + same attribute + same intent | Two pages competing for identical query set | Merge or differentiate via journey stage |
| Same entity + different attribute + same intent | Risk only if SERP overlap is high | Tool-Assisted: check SERP overlap. Manual: differentiate angle. |
| Same entity + same attribute + different intent | Generally safe — different journey stages | Verify intents are genuinely different |
| Different entity + same attribute | Safe | No action |

> **⛳ CHECKPOINT 5:** User confirms the cleaned map.

---

## Phase 5: Build the Map (Steps 12–20)

### Step 12 — Raw Topical Map

Output the Tier 1 table: Section, Sub-section, Raw Topic, Intent, Priority + reasoning, Node Type, Fan-Out Tag, Notes.

### Step 13 — Quality Nodes (2–5)

Quality Nodes are the cornerstone pages linked from the homepage. They:
- Cover the most important topics in Core comprehensively
- Are the largest pages on the site (often 5,000+ words)
- Receive the most internal links
- Drive the most authority transfer

**Selection criteria:**
- Topic is in Core Section
- Topic has high commercial value (monetizes the audience)
- Topic has enough breadth to support a fan-out tree
- Topic has stable demand (not Trending)

For each Quality Node selected, generate a fan-out tree (Step 8.7) showing every sub-topic the node will internally link to.

### Step 14 — Trending Nodes

Trending Nodes are currently-popular topics connected back to Core. They:
- Capture transient demand
- Build short-term traffic
- Get refreshed or sunset as relevance fades

**Detection:** Use Google Trends, social media, news scanning. Mark each Trending Node with an expected lifespan.

### Steps 15–19 — Tier 2 Publishing Metadata

Per page, generate:

- **Title Tag (Step 15)** — using one of 4 methodologies: Question, Authority, Comparison, Listicle (full detail in v4.1-additions Section G for format pairing)
- **URL Slug (Step 16)** — hierarchical, no word repetition (`/casino-reviews/stake-us/`, not `/casino-reviews/stake-us-casino-review/`)
- **Meta Description (Step 17)** — extractive summary the user might quote
- **Image URL Slug (Step 18)** — descriptive, alt-text-aligned
- **Image Alt Texts (Step 19)** — describes the image content + entity context
- **Content Format (Step 19b / v4.1 Section G)** — assigned from the 10-format taxonomy

### Step 20 — Internal Linking Architecture

All links flow toward Core. Three layers:

- **Root → Seed → Node**
- Root pages: homepage and main category pages
- Seed pages: Quality Nodes (Step 13)
- Node pages: everything else

**Linking rules:**
- Outer Section pages always link inward to Core
- Core pages link laterally (Core ↔ Core) sparingly, only where genuinely helpful
- Quality Nodes link to all their fan-out children
- Trending Nodes link back to their parent Core topic

> **⛳ CHECKPOINT 6:** User reviews the built map at the requested tier.

---

## Phase 6: Tier 3 Production Handoff (Steps 21–23 + v4.1 additions)

### Step 21 — Entity Map

Per URL, generate:

| Field | Source |
|-------|--------|
| Primary Entity | From Step 3.6 ontology |
| Wikidata Q-ID | Lookup in Wikidata; `[UNRESOLVED]` if not found |
| Schema.org Type | Best match from schema.org type tree |
| sameAs URLs | Wikipedia, official sites, regulator URLs; `[UNRESOLVED]` if not verified |

**Honesty rule:** NEVER guess Q-IDs or sameAs URLs. Better unresolved than fabricated.

### Step 22 — Publication Plan

Output the publishing schedule with order, frequency, and priority tiers. Default cadence:
- New site: 2–3 articles/week, Quality Nodes first
- Growing: 3–5 articles/week
- Established: 1–2 articles/week + 1 refresh/week
- Mature: 1 article/week + 2 refreshes/week

### Step 23 — Schema.org Implementation Notes

Per page type, document the schema patterns. Hand off to `schema-markup-generator` skill for actual JSON-LD generation.

### v4.1 Additions for Tier 3

- **llms.txt** — see Section D of `v41-additions.md`
- **Maintenance KPI Dashboard** — see Section E
- **Share of Model seed query set** — see Section F

---

## Tier 4 — PM Content Plan

See `pm-content-plan-spec.md` for the full XLSX workbook specification. Tier 4 is on-request only; never auto-triggered.

---

## Cross-references

| Need | Reference |
|------|-----------|
| 23-step bird's-eye view | `step-overview.md` |
| Mode guards for Steps 8.1, 13, 14, 23 | `procedure-addendum.md` |
| Quantitative claims rule | `procedure-addendum.md` |
| DataForSEO pipeline detail | `dataforseo.md` |
| v4.1 features (Fan-Out, GEN, Passage Independence, llms.txt, Phase 8, SoM, Format) | `v41-additions.md` |
| Tier 4 PM workbook | `pm-content-plan-spec.md` |
| Advanced topics (NavBoost, EAV, frame semantics, etc.) | `supplementary.md` |
| Koray's GPT agents | `gpt-agents.md` |
| Case studies | `case-studies.md` |
| AIO Risk Score column *(v4.3)* | `aio-risk-score.md` |
| Content briefs (downstream) | `content-brief-generator` skill |
| Blog post generation (downstream) | `seo-blog-generator` skill |
| Schema JSON-LD (downstream) | `schema-markup-generator` skill |
