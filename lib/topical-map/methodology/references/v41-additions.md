# v4.1 Additions Reference

Full specifications for all features added in topical-map-creation v4.1.

---

## Table of Contents

| Section | Feature | Phase Applied |
|---------|---------|--------------|
| [A](#a-query-fan-out) | Query Fan-Out | Phase 3 (Step 8.7) |
| [B](#b-generative-intent) | Generative Intent (5th type) | Phase 4 (Step 9) |
| [C](#c-passage-independence-spec) | Passage Independence Spec | Phase 4 / Content Brief |
| [D](#d-llmstxt-deliverable) | llms.txt Deliverable | Tier 3 |
| [E](#e-phase-8-maintenance-protocol) | Phase 8 Maintenance Protocol | Post-publication |
| [F](#f-share-of-model-kpi) | Share of Model KPI | Ongoing measurement |
| [G](#g-format-column-tier-2) | Format Column | Tier 2 |

---

## A. Query Fan-Out

### What It Is

Google AI Mode (and AI Overviews) does not answer queries directly. It first **fans out** the user's query into 5–15 sub-queries, retrieves pages for each, then synthesizes a response. A topical map built for AI Mode must pre-model these fan-out branches and ensure each branch is covered by at least one dedicated page or passage.

### Research from Google I/O 2024 + SEO observations

- AI Mode's multi-step reasoning breaks queries into atomic sub-intents
- Each sub-query is answered by a separate retrieval pass
- Pages that answer fan-out sub-queries get cited even if they don't rank for the head query
- Coverage of fan-out branches → higher citation frequency across all related queries

### Step 8.7: Query Fan-Out Generation (NEW — add to Phase 3)

For each **Quality Node** and each **High-priority Core topic**, generate the fan-out sub-query tree:

**Input:** One topic (e.g., "enclomiphene vs TRT")

**Process:**
1. State the topic as a user question ("What is the difference between enclomiphene and TRT?")
2. Generate 5–8 sub-questions an AI model would need to answer to synthesize a response:
   - "What is enclomiphene?" → maps to `/enclomiphene/what-is-enclomiphene`
   - "What is TRT?" → maps to `/testosterone-therapy/what-is-trt`
   - "Does enclomiphene preserve fertility?" → maps to `/enclomiphene/enclomiphene-fertility`
   - "What are TRT side effects?" → maps to `/testosterone-therapy/trt-side-effects`
   - "How do both affect testosterone levels?" → existing evidence pages
3. **Gap check:** Are all fan-out branches covered by existing map topics?
4. **Add missing branches** as new topics (tagged `[FAN-OUT]`)
5. **Mark Coverage Status** per fan-out branch: ✓ Covered / ⚠ Partial / ✗ Gap

**Deliverable per Quality Node:** A fan-out tree showing the head query → sub-queries → coverage status → URL mapping.

**Output column in Tier 1 Notes:** Add `[FAN-OUT PARENT]` tag to topics that serve as synthesis targets (pages that must be cited when AI answers the head query), and `[FAN-OUT BRANCH]` to dedicated sub-query pages.

**Mode behavior:**
- Manual mode: Generate fan-out branches from semantic reasoning. Label `[ESTIMATED]`.
- Tool-Assisted mode: Cross-reference with Google PAA data (DataForSEO `/serp/google/related_searches/`) to validate sub-queries.

**Priority rule:** Every Quality Node MUST have a complete fan-out tree before Phase 6. This is the single highest-leverage action for Google AI Mode visibility in 2025–2026.

---

## B. Generative Intent

### What It Is

A **5th search intent type** that sits alongside Informational / Commercial / Transactional / Navigational.

**Definition:** Queries where the primary mode of consumption is **AI-generated synthesis**, not a click-through to a source page. The user reads the AI answer; source pages are cited but not visited at high rates.

**Identifiers (how to recognize Generative Intent queries):**
- "What is the best X for Y" → synthesis of options
- "How does X compare to Y" → comparative synthesis
- "Explain X" → educational synthesis
- "What are the [symptoms / side effects / causes] of X" → list synthesis
- Broad definitional queries ("What is testosterone?")
- Any query currently triggering an AI Overview box in Google

**Generative Intent ≠ Informational:**
- Informational → user clicks through to read the page
- Generative → user reads AI answer; site gets a citation, not a click

### Design Implications for Each Intent Type

| Intent | Primary Goal | Key Optimization |
|--------|-------------|-----------------|
| Informational (I) | Rank #1–3, drive clicks | NavBoost optimization, depth, internal linking |
| Commercial (C) | Rank in commercial SERPs, drive comparison clicks | E-E-A-T, comparison tables, schema |
| Transactional (T) | Drive conversions | CTA clarity, trust signals, pricing clarity |
| Navigational (N) | Brand-direct traffic | Entity disambiguation, brand schema |
| **Generative (GEN)** | **Be cited in AI answers** | **Passage independence, structured claims, FAQPage schema, citation-worthy data** |

### Classification Rule

Assign `GEN` when the query:
1. Would currently trigger an AI Overview in Google, OR
2. Is a definitional or comparative query with no clear transactional modifier, OR
3. Is a "how does X work" / "what are the effects of X" pattern

A single topic can have **dual intent**: `I + GEN` (user might click AND AI might cite) or `C + GEN`.

### GEN-Intent Content Requirements

Pages tagged GEN must follow **Passage Independence Spec** (see Section C) and include:
- FAQPage schema with 3–5 questions matching predicted AI sub-queries
- A structured "Key Takeaways" block at the top (AI extracts from the first 100–150 words)
- Every factual claim with a citation anchor (study, guideline, data source)
- No ambiguous pronouns in first-referenced sentences ("It works by..." → "Enclomiphene works by...")

---

## C. Passage Independence Spec

### What It Is

A content architecture rule that ensures every paragraph can be extracted and understood **without requiring surrounding context**. This is critical for:
- AI Overview extraction (Google extracts at passage level)
- Passage Ranking (Google's passage-level indexing system)
- LLM citation (models cite complete thoughts, not fragments)
- Zero-click answer targeting

### The 5 Rules of Passage Independence

**Rule 1 — Entity-First Opening**
Every paragraph must open with the primary entity in subject position.
- ✅ "Enclomiphene raises testosterone by blocking estrogen receptors in the hypothalamus..."
- ❌ "It works by blocking estrogen receptors..."

**Rule 2 — One Claim Per Passage**
Each paragraph contains exactly ONE primary claim. Supporting evidence follows that claim. No compound claims.
- ✅ "Enclomiphene preserves fertility. Unlike TRT, which suppresses LH and FSH, enclomiphene raises both hormones, supporting spermatogenesis. A 2014 RCT (Wiehle et al.) found sperm counts remained in the normal range after 16 weeks of treatment."
- ❌ Paragraph that covers mechanism AND fertility AND dosage AND side effects

**Rule 3 — Bounded Length**
Target 60–120 words per extractable passage. Under 50 = too shallow. Over 200 = AI truncation risk.

**Rule 4 — No Dangling References**
Avoid: "as mentioned above," "this means," "in that case," "the above findings." Every passage must make sense in isolation.

**Rule 5 — Quantified Where Possible**
Vague claims are not cited. Specific, quantified claims are.
- ❌ "Enclomiphene increases testosterone significantly"
- ✅ "Enclomiphene raised total testosterone to a mean of 604 ng/dL at 25mg daily (Wiehle et al., 2014 RCT, n=44)"

### Where to Apply

- **All GEN-intent pages:** Full passage independence audit on every paragraph
- **Quality Nodes:** First 500 words must fully comply
- **All pages:** At minimum, the first 3 paragraphs and any passage that answers a likely AI sub-query

### Passage Independence Flag in Content Briefs

Add to each content brief (seo-blog-generator pipeline):
```yaml
passage_independence: required  # or: recommended / optional
gen_intent: true  # flag if primary or secondary intent is GEN
key_claim_passages:
  - "Enclomiphene dosage and testosterone outcome"
  - "Fertility preservation vs TRT"
  - "FDA status and availability"
```

---

## D. llms.txt Deliverable

### What It Is

`llms.txt` is an emerging standard (llmstxt.org) that helps AI systems understand which pages on a site to prioritize when building knowledge. Analogous to `robots.txt` for traditional crawlers, it is a Markdown file placed at the domain root (`https://[domain]/llms.txt`).

**Current status (April 2026):** Not an official Google/industry standard yet, but adopted by early movers. Anthropic, Perplexity, and Mistral have all acknowledged awareness. Include as a Tier 3 deliverable with this caveat stated.

### Standard Structure

```markdown
# [Site Name]

> [One-sentence site description. Primary topic + purpose.]

## Core Pages (Highest Priority — Cite These First)
- [/url-slug]: [Plain-English description of what the page answers]
- [/url-slug]: [...]

## Supporting Context Pages
- [/url-slug]: [...]

## Reference Data (Factual, Citation-Worthy)
- [/url-slug]: [...]

## Exclude from Synthesis
- /legal/
- /privacy/
- /cart/
- /account/
- /admin/

## Update Frequency
Core pages reviewed: quarterly
Last updated: [YYYY-MM-DD]
```

### Tier 3 Deliverable Instructions

When producing llms.txt as a Tier 3 output:

1. **Core Pages section**: Include all Quality Nodes + Tier 1 High-priority Core topics (max 15 URLs). Write the description as a one-sentence answer to "What does this page tell an AI?"

2. **Supporting Context section**: Include remaining Core topics + high-priority Outer topics (max 30 URLs).

3. **Reference Data section**: Include any pages with original research, statistics, clinical evidence summaries, or comparison tables — these are the highest-value citation targets.

4. **Exclusion list**: Always exclude: /legal, /privacy, /cart, /account, /sitemap, /feed, /tag/, /author/ (unless author pages have meaningful bio content)

5. **Update frequency**: Set based on publication plan — typically "core pages reviewed quarterly."

6. **Companion: llms-full.txt** (Optional): A longer version listing all 90+ URLs with full descriptions, for AI systems that can process larger context. Reference from llms.txt: `## Full index available at /llms-full.txt`

### Honesty Note

State in the deliverable: "llms.txt is not an official standard as of the map creation date. Its adoption by AI crawlers is voluntary and unverified. Deploy as a low-cost, high-optionality signal — not as a confirmed ranking or citation mechanism."

---

## E. Phase 8 Maintenance Protocol

### What It Is

A structured ongoing maintenance plan that runs after the topical map is fully published. Phase 8 makes the topical map a **living system** rather than a static deliverable.

### The 4-Rhythm Maintenance Cadence

**Monthly (30-min check)**
- [ ] Quality Node rank tracking: are the 5 Quality Nodes in top 5 for their target query?
- [ ] New fan-out branch detection: run head queries in AI Mode / Perplexity — any new sub-queries appearing?
- [ ] Share of Model spot check: ask 1–2 LLMs 5 seed queries. Is the site cited?
- [ ] Trending Nodes: any new trending topics in the niche to add?

**Quarterly (2–4 hours)**
- [ ] Content decay audit: identify pages that have lost >20% traffic or rankings in 90 days
- [ ] Content gap audit: scrape competitor new URLs (Ahrefs site: operator), identify gaps vs. map
- [ ] AI Overview coverage: which map topics now trigger AI Overviews? Are the site's pages being cited?
- [ ] Internal link audit: any broken links? New pages needing inbound links?
- [ ] Passage Independence review: spot-check 5 random pages for compliance

**Bi-annually (full-day review)**
- [ ] Full topical map expansion: are new sub-sections needed?
- [ ] Entity drift check: has the Central Entity definition shifted? (niche evolution, new competitor positioning)
- [ ] Quality Node refresh: update statistics, citations, and structured data on all 5 Quality Nodes
- [ ] llms.txt update: add new Core pages published since last review

**Triggered (on-demand, within 48 hours of trigger)**
- [ ] Algorithm update: if a core algorithm update is confirmed, run full topical map audit (siteRadius, siteFocusScore implications)
- [ ] Competitor new page: if a competitor publishes in a gap area, fast-track that topic
- [ ] Trending keyword spike: if a related term spikes in Google Trends, evaluate for fast-publish

### Maintenance KPI Dashboard (Tier 3 Deliverable)

Include in Tier 3 Publication Plan a KPI tracking table:

| KPI | Current | Target | Measurement Method |
|-----|---------|--------|--------------------|
| Quality Node average rank | — | ≤ 5 | Ahrefs / GSC |
| AI Overview coverage (% of Core topics) | — | ≥ 40% | Manual check |
| Share of Model (% of seed queries cited) | — | ≥ 25% | Manual LLM audit |
| Content decay pages | — | 0 | Quarterly decay audit |
| Fan-out coverage (% of QN branches covered) | — | 100% | Quarterly gap check |
| llms.txt Core pages listed | — | All Quality Nodes | Site audit |

---

## F. Share of Model KPI

### What It Is

**Share of Model (SoM)** measures how frequently a site is **cited, referenced, or surfaced** when large language models answer queries in the site's topical domain. It is the GEO/AEO equivalent of organic market share.

**Formula:**
```
SoM = (Queries where site is cited) / (Total seed queries tested) × 100
```

**Example:** If ttime.men is cited in 18 of 50 seed queries about testosterone optimization asked to 3 LLMs → SoM = 36%.

### Why It Matters More Than SERP Rankings for GEO

- AI Mode, AI Overviews, and chatbot answers increasingly bypass traditional SERPs
- A site can have zero organic click traffic from a query but still influence the AI answer
- Share of Model predicts the trajectory of citation volume as AI search grows
- It is the forward-looking KPI that Share of Voice (SOV) in SERPs was in 2015

### Measurement Protocol

**Step 1 — Build the seed query set**
Select 30–50 queries from the Core section of the topical map:
- Include all Quality Node head queries
- Include 5–10 symptom/definition queries (GEN-intent)
- Include 5 commercial comparison queries
- Include 5 branded queries (site name + key offer)

**Step 2 — Run across 3 platforms**
Test each query on: Google AI Mode, Perplexity, ChatGPT (GPT-4o). Record:
- Was the site cited? (Y/N)
- If cited: as primary source, supporting source, or competitor comparison?
- Which URL was cited?
- Was a competitor cited instead?

**Step 3 — Calculate SoM**
```
SoM per platform = (Cited queries on that platform) / (Total seed queries) × 100
Blended SoM = Average across all 3 platforms
```

**Step 4 — Competitive SoM**
Run the same seed queries and record competitor citations. Calculate each competitor's SoM for the same seed set.

**Reporting format:**
```
Seed queries: 40
Platform: Google AI Mode | Perplexity | ChatGPT
ttime.men SoM: 12% | 18% | 8%
Hims SoM: 45% | 52% | 61%
Gap to close: -33% | -34% | -53%
```

**Target cadence:** Measure at map launch (baseline), then monthly for first 6 months, quarterly thereafter.

### Share of Model in the Tier 1 Map

Add SoM-target tagging to each topic in Notes:
- `[SoM TARGET]` — pages where being cited in AI answers is the primary conversion mechanism (mostly GEN-intent Core pages)
- `[SoM BRIDGE]` — pages that should be cited alongside a competitor page to establish co-authority in AI answers

---

## G. Format Column (Tier 2)

### New Column: Content Format

Add as the **last column** in Tier 2 Publishing Metadata.

**Purpose:** Specifies the structural template for content production, distinct from the Schema.org type. Guides writers and the seo-blog-generator pipeline on the correct format before writing begins.

### Format Options

| Format | When to Use | AI Overview Suitability |
|--------|-------------|------------------------|
| **Evergreen Article** | In-depth explainer, 1,500–3,000 words | Medium — good for GEN synthesis |
| **Clinical Evidence Review** | Treatment/drug/supplement pages with RCT data | High — structured claims cited directly |
| **Comparison Table** | "X vs Y" commercial topics | Very High — AI Overviews often extract tables |
| **Step-by-step Guide / HowTo** | Process, protocol, how-to queries | Very High — HowTo schema + numbered lists |
| **FAQ Hub** | GEN-intent definition queries | Very High — FAQPage schema maps 1:1 to AI answers |
| **Symptom Checklist** | Symptom/diagnosis pages | High — ItemList extraction |
| **Listicle** | "Best X", "Top Y" formats | Medium — AI extracts top items |
| **Calculator / Interactive Tool** | Dosage calculators, range checkers | Low for AI citations; High for NavBoost |
| **Case Study / Data Report** | Original research, statistics, studies | Highest — primary source citation target |
| **Landing Page (Commercial)** | Direct product/service conversion | Low for AI; High for NavBoost + conversions |
| **News / Update** | Time-sensitive developments | Medium — AI Mode surfaces recent news |

### Format Assignment Rules

1. GEN-intent topics → FAQ Hub, Clinical Evidence Review, or Comparison Table (in that order of preference)
2. Quality Nodes → Evergreen Article OR Clinical Evidence Review
3. Trending Nodes → Evergreen Article (with News/Update refresh cadence)
4. Commercial intent → Landing Page or Comparison Table
5. HowTo intent → Step-by-step Guide
6. Symptom/definition → FAQ Hub or Symptom Checklist

### Format in Content Briefs

This field passes directly to the seo-blog-generator pipeline as `content_format` in the YAML frontmatter. The blog generator uses it to select the appropriate document template (Step 22 of the 31-step procedure).
