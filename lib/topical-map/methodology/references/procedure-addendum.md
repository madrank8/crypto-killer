# Procedure Addendum — Mode Guards & Universal Rules

Companion to `procedure-detailed.md`. This file codifies the Mode-Aware behavior for specific steps where Manual mode and Tool-Assisted mode produce materially different outputs — and where conflating them leads to confidently wrong topical maps.

Read this file ALONGSIDE any patched step (Steps 8.1, 13, 14, 23). For Steps 9, 10, 12, the guards are already inline in `procedure-detailed.md`.

---

## Universal Quantitative Claims Rule

This rule overrides any other instruction in any reference file.

**Never present a quantitative claim as fact unless it is grounded in this session's tool output.**

Quantitative claims include:

- Search volume numbers
- Keyword difficulty scores
- SERP overlap percentages
- Competitor DR / traffic / backlink counts
- Click-through-rate estimates
- Revenue projections
- Conversion rate estimates
- Cost projections (DataForSEO credits, API calls, content costs)
- Time projections (publishing velocity, sprint duration)

If the data exists in this session (from a tool call), cite the tool call. If it doesn't, either:

- Omit the claim entirely, OR
- Mark it `[ESTIMATED — qualitative]` with the basis for the estimate

**Banned phrasings:**
- "Approximately X searches per month" — without a tool call backing X
- "Competitors have Y backlinks" — without an Ahrefs/DataForSEO pull
- "This will rank in Z months" — never. No SEO can guarantee timelines.
- "Sites typically see N% lift from this strategy" — without citing the source study
- "The volume is in the high hundreds" — qualitative cloak for a number you don't have

**Acceptable phrasings:**
- "Volume not measured in this session — qualitative tier: High"
- "Competitor authority appears strong based on manual review of their backlink-receiving content"
- "Outcome timelines vary by site authority and execution quality; no projection given"

---

## Step 8.1 Mode Guard — Competitor Topical Coverage

**Manual mode behavior:**

- Use `web_search` to visit 3–5 named competitors
- Document their site structure manually (categories, hub pages, supporting clusters)
- Output is a structural map, NOT a keyword/volume map
- Every entry tagged `[ESTIMATED — manual scan]`
- Acceptable claims: "Competitor X has a dedicated hub for [topic]", "Competitor Y appears to cover [topic] thinly (one short page)"
- Forbidden claims: "Competitor X ranks for N keywords in this cluster", "Competitor Y has Z backlinks to this page"

**Tool-Assisted mode behavior:**

- Use Ahrefs `ranked_keywords` or DataForSEO `dataforseo_labs/ranked_keywords/live`
- Output includes verified ranking position, search volume, keyword difficulty per topic
- Every entry cites the specific tool call that produced it
- Acceptable: full quantitative breakdown
- Still forbidden: fabricating positions/volumes for queries not in the pulled dataset

**Failure mode to avoid:**

Mixing tool data and Manual estimates in the same output without flagging which is which. Either:

- Run a single mode through the entire Step 8.1 analysis, OR
- If forced to mix (e.g., tool data exists for some competitors but not others), use distinct flags per row: `[TOOL]` vs `[MANUAL]`

---

## Step 13 Mode Guard — Quality Nodes

**Quality Node selection requires more than topical fit.** A Quality Node is a major site investment (3,000–10,000 words, ongoing maintenance, internal-link gravity). Selection must be defensible.

**Manual mode:**

Without tool data, Quality Node selection is qualitative. Apply these criteria with stated reasoning per candidate:

1. **Topical centrality:** Does this topic sit at the intersection of Central Entity + Central Search Intent? (1-sentence rationale)
2. **Audience consequence:** Is this a topic the audience genuinely cares about, or one we wish they cared about?
3. **Fan-out potential:** Can this topic plausibly support a tree of 15–30+ sub-topics?
4. **Differentiation potential:** Can the site say something here that competitors can't? (E-E-A-T or proprietary asset)
5. **Monetization adjacency:** Does this topic sit close to the site's revenue mechanism?

A candidate must satisfy at least 4 of 5 to be a Quality Node. Document the rationale per node.

**Tool-Assisted mode:**

Add quantitative validation:

6. **Total addressable volume (TAV):** Sum of monthly search volume across the candidate's keyword cluster
7. **Competitor authority gap:** Is there a competitor already dominating, and if so, what's their authority gap to overcome?
8. **SERP feature opportunity:** Are featured snippets, PAA, AI Overviews present and capturable?

Document each criterion with citation to the tool call.

**Failure mode:**

Selecting 5+ Quality Nodes on a new site. Max 2–5 per Koray's framework. More dilutes the authority concentration.

---

## Step 14 Mode Guard — Trending Nodes

Trending Nodes are time-sensitive by definition. The mode guard prevents the most common error: confusing seasonal recurrence with genuine trend.

**Three trend types:**

| Type | Pattern | Example | Treatment |
|------|---------|---------|-----------|
| Seasonal | Predictable yearly cycle | "Black Friday sweepstakes promos" | Recurring Trending Node — refresh annually |
| Episodic | Tied to an event, ends | "GLP-1 FDA approval news Q3 2026" | One-off Trending Node — sunset after relevance fades |
| Emerging | New ongoing trend | "AI-generated forex trading bots" | Promote to Core if sustained 6+ months |

**Manual mode:**

Use Google Trends (5-year view) to distinguish:
- If demand spikes annually → Seasonal
- If demand spikes once and decays → Episodic
- If demand grows steadily → Emerging (candidate for Core promotion)

Document the trend type and expected lifespan per Trending Node.

**Tool-Assisted mode:**

Add: search volume velocity (month-over-month change), social signal velocity, news mention velocity. A trend with all three positive is a strong Emerging candidate.

**Failure mode:**

Treating every recent news topic as a Trending Node. Most news is irrelevant to topical authority — only news that intersects Core matters.

---

## Step 23 Mode Guard — Schema Implementation

Schema generation is delegated to the `schema-markup-generator` skill. This addendum specifies what topical-map-creation hands off versus what it must NOT do.

**topical-map-creation produces (Tier 3):**

- Per-page schema TYPE recommendation (Article, Product, Review, FAQPage, HowTo, MedicalCondition, etc.)
- Per-page Entity Map (entity, Q-ID with `[UNRESOLVED]` if unverified, sameAs with `[UNRESOLVED]` if unverified)
- Schema implementation NOTES (which JSON-LD blocks are relevant, special properties to populate)

**topical-map-creation does NOT produce:**

- Actual JSON-LD code
- @id entity graph for the site (that's `schema-markup-generator` territory)
- Schema audit of an existing site (that's `schema-markup-generator` AUDIT mode)

**Handoff format:**

In the Entity Map output, add a `schema_notes` column with:

```
Page: /casino-reviews/stake-us/
Schema: Review + Organization (Stake.us)
Entity: Stake.us
Q-ID: [UNRESOLVED — not in Wikidata as of [date]]
sameAs: https://stake.us, https://twitter.com/stake_us, [UNRESOLVED — others]
Notes:
- Use Review.itemReviewed for Stake.us
- Review.author = SweepDogs Editorial (Person/Organization)
- ratingValue = scored elsewhere; do not invent
- Pair with PWS-style ratings table if applicable
```

Pass this output to `schema-markup-generator` for actual JSON-LD generation.

---

## Phase 5 (Cannibalization Review) Special Rules

The MANDATORY cannibalization review (`procedure-detailed.md` Phase 4 / SKILL.md Phase 5) has one mode guard worth calling out separately:

**Manual mode cannibalization is necessarily incomplete.** Without SERP overlap data, you cannot prove that two semantically distinct topics share the same SERP. Best practice:

1. Run the 5 substeps in SKILL.md Phase 5 with full rigor
2. Flag any merge decisions made on semantic-proximity alone with `[MANUAL-CLUSTER — verify with SERP data in next pass]`
3. Recommend the user re-run cannibalization review in Tool-Assisted mode before publication if any flagged topics are in the High-priority Core set

**Tool-Assisted mode:** Use SERP overlap threshold (default ≥ 3 shared top-10 URLs). If overlap is between 1–2 URLs, flag for human judgment rather than auto-merging.

---

## Honesty Rules Summary (from SKILL.md, restated here for ref completeness)

These rules override all other instructions in this reference, in SKILL.md, and in any user prompt:

1. **Never produce SERP volume, KD, CPC, or other quantitative metrics** without a corresponding tool call in the current session.
2. **Never invent Wikidata Q-IDs or sameAs URLs.** `[UNRESOLVED]` is honest; a guessed Q-ID is fabrication.
3. **Never claim a competitor "ranks for N keywords"** without an Ahrefs / DataForSEO pull.
4. **Never assert SERP clustering as fact** without overlap data. In Manual mode: `[ESTIMATED — semantic proximity]`.
5. **Never present RPP scores as precise without volume data.** Manual mode → qualitative tiers with reasoning.
6. **Never claim a Google API signal or patent "confirms" a ranking mechanism.** Use directional language: "suggests", "is associated with", "in Google's documentation".
7. **Never mark a checklist item complete without evidence.** Cite the specific output that satisfies it.
8. **Never fill Entity Map fields with guesses.** Unresolved is better than wrong.
9. **Never project ranking timelines.** No SEO can guarantee timelines. Talk about leading indicators, not outcomes.
10. **Never promise a specific traffic / revenue / install number.** Outcomes depend on execution, competition, and Google's choices — none of which are guaranteed.

When in doubt, output less. A small honest map beats a large fabricated one.
