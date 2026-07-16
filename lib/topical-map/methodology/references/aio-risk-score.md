# AIO Risk Score Column — Methodology Reference

Per-topic AI Overview exposure scoring for the Tier 1 Strategic Map column added in v4.3. Grounded in Seer Interactive's 2026 AIO study (5.47M queries, 53 brands, Jan 2025–Feb 2026) and corroborating research from Semrush, Ahrefs, BrightEdge, Pew, and ZipTie.

> **Honesty rules for this file:** All numeric claims cite a primary source. Where studies disagree, ranges are presented rather than a single number. Where the Seer methodology is unverified or partial, this is flagged. AIO Risk Score is a directional planning tool, not a Google-confirmed mechanism. Topics scored High/Critical should be planned for mitigation, not avoided wholesale — being cited in an AIO drives ~120% more clicks per impression than being on an AIO SERP uncited (Seer 2026).

---

## What the AIO Risk Score column captures

A per-topic estimate of **how exposed this topic is to AI Overview displacement of organic clicks** if the page does not earn a citation inside the AIO.

| Score | Meaning | Action |
|-------|---------|--------|
| **Low** | AIO unlikely to trigger; classic ranking still dominates | Standard SEO; passage independence optional |
| **Medium** | AIO triggers sometimes; CTR pressure present but not severe | Standard SEO + extractive-answer opening |
| **High** | AIO triggers ≥60% of the time; severe CTR pressure if uncited | Aggressive AEO: passage independence, schema, source authority, citation hooks |
| **Critical** | AIO triggers ≥85% of the time; the topic is partially or fully zero-click | Either commit full AEO/GEO investment, or treat as a brand/visibility play and don't expect organic clicks |

This is a **planning column**, not a forecast. Use it during Phase 4 to set the priority and the content-format expectation for each topic, and to flag which Quality Nodes need extra investment in AI Overview citation strategy.

---

## Scoring rubric — 7 factors

Each factor contributes 1–4 points. Sum the 7 factors → 7–13 = Low, 14–18 = Medium, 19–23 = High, 24–28 = Critical. Always document the per-factor score with reasoning.

### Factor 1: Search Intent (5-type, per v4.1 Section B)

Source: Seer 2026 trigger rates (49,353 queries):
- Informational: 36% trigger rate (some narrower informational categories above 80%)
- Commercial: 8% trigger rate
- Transactional: 5% trigger rate
- Navigational: low (typically <10%)
- Generative (GEN): definitionally high — these are queries that exist to be answered by AI synthesis

Corroborating: Semrush (10M+ keywords) shows the informational share of AIO triggers dropped from ~91% in early 2025 to ~57% by October 2025 — meaning commercial and transactional are increasingly exposed even if their base rate is lower.

| Intent | Score |
|--------|-------|
| Generative (GEN) | 4 |
| Informational | 3 |
| Commercial | 2 |
| Transactional | 1 |
| Navigational | 1 |

### Factor 2: Query Format

Source: Seer 2026 (within 30,842 tracked informational queries):
- Comparison ("X vs Y", "best X for Y"): 95.4% AIO trigger
- Question-format (who/what/when/where/why/how): 85.9% trigger
- Review-format: 86.3% trigger
- "Near me" informational: 76.9% trigger
- Single-word queries: 27.3% trigger (lowest)

| Format | Score |
|--------|-------|
| Comparison / "X vs Y" / "best X for Y" | 4 |
| Question (who/what/when/where/why/how) | 4 |
| Review / "X review" / "is X worth it" | 4 |
| "Near me" informational | 3 |
| Multi-word descriptive | 3 |
| Single-word / branded | 1 |

### Factor 3: Query Length

Source: ZipTie / multiple corroborating studies (2026):
- 4+ word queries: ~60.85% AIO trigger
- Question-phrased queries: 57.9% (in the relevant subset)
- Single-word: 27.3% (Seer)

Longer queries signal more specific informational intent, which AI synthesis handles confidently.

| Length | Score |
|--------|-------|
| 5+ words, full sentence | 4 |
| 3–4 words | 3 |
| 2 words | 2 |
| 1 word | 1 |

### Factor 4: Vertical / Industry

Source: Digital Applied / ALM Corp / BrightEdge (2026) — vertical-level AIO presence:

| Vertical | Score |
|----------|-------|
| Healthcare | 4 (88% trigger) |
| Education | 4 (83%) |
| B2B Technology | 4 (82%) |
| Restaurant / Local food | 3 (78%) |
| Insurance / Financial services informational | 3 (63%) |
| Entertainment | 2 (37%) |
| eCommerce — informational queries | 3 |
| eCommerce — transactional queries | 1 (as low as 4% per WordStream / SEL) |
| Travel — informational | 3 |
| Travel — transactional / booking | 2 |
| Sweepstakes / iGaming / Crypto | 2 (qualitative — limited published data; YMYL caution suppresses some triggers) |
| Forex / CFD | 2 (qualitative — similar; YMYL caution applies) |
| Real estate / Automotive transactional | 1 |

**For verticals not listed:** estimate from nearest analog and mark `[ESTIMATED — no published vertical data]`.

### Factor 5: YMYL Status

Source: BrightEdge (2026) — high-risk YMYL queries (medical advice, legal rulings, financial transactions) trigger AIO only ~11% of the time. Google appears to suppress AIO on the highest-stakes YMYL.

But: YMYL adjacent topics (health information, legal information generally) trigger frequently. The suppression applies to transactional/advisory YMYL, not the broader informational tier.

| YMYL status | Score |
|-------------|-------|
| High-risk YMYL transactional (specific medical advice, legal ruling, specific financial transaction) | 1 (Google suppresses AIO here) |
| YMYL informational (general health, legal background, financial education) | 4 |
| Non-YMYL | (score from Factor 4 alone; no adjustment) |

This factor either pulls the score *down* (high-risk YMYL transactional gets a 1, lowering the total) or *up* (YMYL informational stays at 4).

### Factor 6: Featured Snippet Presence (Pre-AIO Signal)

Source: ZipTie (2026) — pre-AIO featured snippet presence is one of the strongest individual predictors of AIO citation likelihood. AI Overviews frequently pull from the same source pool that historically won featured snippets.

| Featured snippet status | Score |
|--------------------------|-------|
| Snippet present in current SERP for this query | 3 |
| Snippet has been present in last 6 months (Wayback / Ahrefs history) | 2 |
| No snippet history | 1 |

Note: this factor measures AIO **citation opportunity**, not pure risk. A topic with high snippet presence is high-citation-opportunity AND high-AIO-likelihood — score both.

### Factor 7: SERP Competition Density

Source: directional from Seer 2026 + Ahrefs (146M results, 20.5% AIO trigger rate):
- AIO is more likely when many established competitors crowd the top 10
- Less likely when the SERP is dominated by Reddit/forum/Quora content (Google appears to suppress AIO on low-authority SERPs)

| SERP competition | Score |
|------------------|-------|
| 5+ high-authority sites in top 10 (well-known publishers, brands) | 4 |
| 3–4 authoritative sites + mix | 3 |
| Reddit/forum/Quora dominated SERP | 1 (AIO suppression likely) |
| Sparse SERP, mixed quality | 2 |

---

## Scoring example — SweepDogs topic "is stake.us legal in California"

| Factor | Score | Reasoning |
|--------|-------|-----------|
| Intent | 3 | Informational (legality question) |
| Format | 4 | "Is X legal in Y" is a question-format |
| Length | 4 | 7 words |
| Vertical | 2 | iGaming — limited published vertical data; estimating moderate AIO presence |
| YMYL | 4 | YMYL informational (legal info, not legal advice) |
| Featured Snippet | 2 | Historical snippet presence on similar queries |
| SERP Competition | 3 | Mix of established sweepstakes sites + state AG sites |
| **Total** | **22** | **High** |

**Interpretation:** This is a topic SweepDogs should aggressively optimize for AIO citation: extractive answer in the opening, state-by-state schema, citations to actual state AG opinions and statutes, passage independence per state-section. Not a topic to deprioritize — being cited drives ~120% more clicks per impression than non-citation, and the 50-state legality tracker page is well-positioned to be the canonical source.

---

## Scoring example — ttime.men topic "buy semaglutide online prescription"

| Factor | Score | Reasoning |
|--------|-------|-----------|
| Intent | 1 | Transactional |
| Format | 3 | Multi-word descriptive |
| Length | 4 | 5 words |
| Vertical | 4 | Healthcare (88% trigger) |
| YMYL | 1 | High-risk YMYL transactional — Google likely suppresses AIO |
| Featured Snippet | 1 | Transactional queries rarely show snippets |
| SERP Competition | 4 | Telehealth ad-heavy, multiple established providers |
| **Total** | **18** | **Medium** |

**Interpretation:** AIO unlikely to trigger heavily on this specific transactional query (the YMYL-transactional suppression factor + transactional intent both pull risk down). But the informational sibling — "what is semaglutide" — would likely score 24+ (Critical). Different content formats serve each.

---

## Aggregating across the topical map

After scoring every topic in the map, look at the distribution:

| Distribution | Diagnostic |
|--------------|------------|
| >60% Low/Medium | Map is mostly classic-SEO territory; standard pipeline works; allocate ~20% of effort to AEO |
| 30–60% High/Critical | Map is AI-search-exposed; restructure briefs to lead with extractive answers, invest in entity authority, plan passage independence for every High+ topic |
| >60% High/Critical | Map is fundamentally an AI-search problem. Reconsider the strategy. Two paths: (a) full AEO/GEO investment with `geo-aeo-layer` skill as the primary lens; (b) brand-as-citation play with proprietary assets (`proprietary-asset-inventory.md`) as the moat |

**Watch for:**

- **Quality Nodes that score High/Critical:** these are the most expensive pages to build *and* the most vulnerable to AI displacement. Either commit full AEO investment per node, or reconsider whether they should be Quality Nodes at all.
- **Trending Nodes that score Critical:** trending + AI-Overview-prone = especially short publication window. Consider whether the lift justifies the build.

---

## Mitigation playbook by score

### Low (7–13)

- Standard `seo-blog-generator` pipeline
- No special AEO requirements
- Optional: include schema for entity recognition; doesn't hurt

### Medium (14–18)

- Standard pipeline + **extractive-answer opening** (first 60 words = the literal answer)
- Schema.org for entity + page type (Article, Product, Review, etc.)
- Featured snippet target in mind

### High (19–23)

- Full AEO treatment:
  - **Passage independence** required for every H2 section (see `supplementary.md` § S19)
  - **Lead with the answer**, develop nuance afterward
  - **Cite primary sources** within content (sites that cite well are cited more, per the Seer/Surfer/ZipTie consensus)
  - **Schema.org** with deep entity properties (sameAs, knowsAbout, citation)
  - **Author entity** with credentials (see `supplementary.md` § S7)
  - Run `geo-aeo-layer` skill in AUDIT mode pre-publish

### Critical (24–28)

- Everything from High, plus:
  - **Treat the page as a citation magnet, not a click destination**. The KPI is appearance in AIO + citation share, not just CTR
  - **Build a proprietary asset hook** — original data, structured data feed, expert quotes, exclusive analysis. Without something AI cannot synthesize from other sources, the page is fungible
  - **Track Share of Model** explicitly (v4.1 Section F) for this topic across ChatGPT / Gemini / Perplexity / Claude
  - Consider format alternative: interactive tool, calculator, or comparison widget — content types that AIO cannot replicate (per `digitalapplied.com` analysis, interactive tools see <3% AIO disruption)

---

## Important caveats

1. **The 61% headline CTR drop is misleading.** Seer themselves clarify: pages cited in AIO get 120% more clicks per impression than uncited pages on AIO SERPs. The danger is being on an AIO SERP without being cited, not the presence of AIO itself.
2. **The trend has leveled off.** Seer's 2026 update shows organic CTR on AIO queries rebounded from 1.3% (Dec 2025) to 2.4% (Feb 2026) — an 85% rebound in two months. The Q1 2026 narrative of permanent CTR collapse is not supported by current data. Plan for elevated AIO presence; don't plan for permanent CTR death.
3. **Query-type matters more than vertical.** A comparison query in a low-trigger vertical (e.g., automotive) can still face >90% AIO presence; a transactional query in a high-trigger vertical (e.g., healthcare) may face very little. Score by query, not by vertical alone.
4. **Direction of travel is up.** Semrush data shows informational queries fell from 91% to 57% as a share of AIO triggers in 2025 — meaning commercial, transactional, and navigational queries are *increasing* their share. Vertical scoring above should be re-checked every 6 months.
5. **YMYL transactional gets AIO suppression.** Google appears reluctant to surface AI summaries for high-stakes medical, legal, or financial decisions (BrightEdge 2026: ~11% trigger). This is a meaningful protection layer for purely transactional YMYL queries — but the informational sibling queries don't get the same protection.
6. **Citation source distribution is wider than top 10 organic.** Surfer SEO's analysis of 36M AIOs and 46M citations found YouTube ~23%, Wikipedia ~18%, Google.com ~16% as the top citation sources. For eCommerce, 61.5% of AIO citations come from sources *outside* the organic top 100. Ranking organic is not the same as being citation-eligible.

---

## Integration with other skills

| When | Use |
|------|-----|
| Scoring during Phase 4 of topical-map-creation | This file's rubric |
| Building a Quality Node that scored High/Critical | `geo-aeo-layer` skill — OPTIMIZE mode |
| Auditing an existing site for AIO exposure | `geo-aeo-layer` skill — AUDIT mode (100-point scorecard) |
| Measuring AIO citation share post-launch | `geo-aeo-layer` skill — MEASURE mode + `tavily-news-monitor` for engine-watching |
| Generating brief for a High+ topic | `content-brief-generator` skill — flag for passage independence + extractive answer requirements |
| Drafting a High+ article | `seo-blog-generator` skill — anti-slop checklist + AIO extractability stage |
| Schema for an AIO-targeted page | `schema-markup-generator` skill — entity graph with sameAs |
| Validating an AIO-targeted page pre-publish | `redteam-multi` skill — passage independence check |

---

## Sources cited in this file

- **Seer Interactive 2026 update** ("AIO Impact on Google CTR: 2026 Update", published April 2026): 53 brands, 5.47M queries, 2.43B organic impressions, Jan 2025–Feb 2026. Primary source for trigger rates by intent and query format.
- **Seer Interactive September 2025 update** ("AIO Impact on Google CTR: September 2025 Update"): the 61% CTR drop figure.
- **Search Engine Journal** ("AI Overview CTR Fell 61%, But Clicks Didn't Collapse", Matt G. Southern, April 2026): contextualizing the Seer 2026 update.
- **Search Engine Land** ("Google AI Overviews CTR shows early signs of recovery", Danny Goodwin, April 2026): the 85% rebound (1.3% → 2.4%).
- **Semrush** (10M+ keywords analyzed 2025): intent-share shift from 91% informational to 57%.
- **Ahrefs** (analysis of 146M results, 2025): 20.5% AIO trigger rate baseline; 99.2% of informational keywords in their dataset trigger AIO.
- **BrightEdge** (12-month measurement period ending Feb 2026): vertical-level AIO presence rates and 58% YoY growth across 9 industries.
- **ZipTie** (2026 analysis): query-length triggers (4+ words: 60.85%), branded vs. non-branded splits.
- **Digital Applied / ALM Corp** (Q1 2026): industry trigger rates (healthcare 88%, education 83%, B2B tech 82%, etc.).
- **Surfer SEO** (36M AIOs, 46M citations analyzed): citation source distribution.
- **Pew Research** (2025): query-format AIO correlation (longer queries, question-led queries more likely to trigger).

All cited figures are directional planning inputs, not Google-confirmed mechanisms.
