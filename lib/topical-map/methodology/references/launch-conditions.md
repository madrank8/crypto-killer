# Launch Conditions *(v4.7)* — New-Site / Zero-History Launch Mechanics

Phase 1 conditioning layer for maps whose target property is a **new domain or a zero-history section**. Decides launch breadth, compresses the launch URL set (Page-or-Segment), sets the ranking-state KPI ladder, and fixes the expansion origin — *before* topic generation begins. Grounded in Koray Tuğberk Gübür's launch-phase teachings (2024–2026). Every mechanic below is labeled: **[KORAY-OPERATIONAL]** = his documented practice/heuristic, not a Google-confirmed mechanic; **[LEAK/CONFIRMED]** = maps to a documented signal.

**Read when:** Site Type = New Build, OR site age < 12 months, OR the central entity has ≈0 impressions in GSC, OR the user says "launch", "new site", "page or segment", "ranking state", "launch breadth".

**Skip when:** established property with meaningful historical data (route to `site-type-playbooks.md` Existing Expansion instead — this file's ladder still applies to a *new section* on an old domain, scoped to that section).

---

## 0. Why this layer exists

Two launch-phase asymmetries make new domains different in kind, not degree:

1. **Initial ranking is a historical anchor.** The first ranking value assigned to a document alters its re-ranking trajectory — Koray states the effect on historical data is irreversible (holisticseo.digital/theoretical-seo/ranking/). A weak launch cannot be fully iterated out of; the anchor persists in the historical-data component of `TA = Topical Coverage + Historical Data`. **[KORAY-OPERATIONAL]** — directionally consistent with leak-side historical/`urlHistory` structures. Consequence: **the launch batch ships at a raised gate, or it does not ship** (see §6 handoffs → `algorithmic-authorship-gate` NEW-DOMAIN profile).
2. **Every launch URL is a paid test.** New URLs from low-authority sources get delayed rankings; Google does not spend expensive ranking systems on URLs with no click evidence; more low-quality URLs = more tests = higher crawl cost (Koray, CMSEO 2024 — Cost of Retrieval, PageRank per Page). **[KORAY-OPERATIONAL]**, consistent with confirmed crawl-budget/quality-gated indexing behavior (Mueller, Search Off the Record, Jul 2026: quality concerns → crawl less, index less). Consequence: **fewer, denser URLs at launch** (§3–§4).

---

## 1. Brand-Query Association check (BQA)

Determines whether the search engine already associates the brand/source with the central entity. The association decides launch breadth (§2).

**Inputs (Tool-Assisted mode):**
- DataForSEO autocomplete/suggestions for: `{brand}`, `{brand} + {central entity}`, `{central entity} + {brand}` — does the brand surface in autocompletions for the entity space?
- GSC (if any history): non-zero impressions for central-entity query network?
- Ahrefs: existing brand-SERP rankings; any ranking association between domain and central-entity terms.
- Knowledge Graph / entity presence (hand to `classifier-os` entity diagnosis if a full read is needed).

**Manual mode:** run the same checks qualitatively via web_search + manual autocomplete inspection; label every judgment `[ESTIMATED — no API data]` per the universal quantitative-claims rule (`procedure-addendum.md`).

**Output — declare one:**

| BQA state | Evidence | Meaning |
|---|---|---|
| **ASSOCIATED** | Brand appears in autocompletions for the entity space, or ranks for central-entity terms, or GSC shows an existing central-entity query network | The engine already has a brand↔entity prior. |
| **ZERO** | None of the above | No prior. The map must *create* the association. |

Record the BQA state + evidence in the Phase 1 declaration (Checkpoint 1).

---

## 2. Launch breadth decision

**[KORAY-OPERATIONAL]** — from "How to Launch a Semantic Content Network" (Medium, Jan 2024): the SCN you publish must change with website conditions (topic prioritization, historical data, PageRank, brand value).

| BQA state | Launch shape | Rationale (Koray) |
|---|---|---|
| **ASSOCIATED** | **NARROW-ROOT:** start from the root via phrase taxonomies; small launch set, depth-first into the core section. | His case: 15 documents outranked far larger companies because the brand *already ranked* for the central entity ("Church Management System"). The prior does the width's job. |
| **ZERO** | **WIDE-FIRST:** the initial map goes wider — establish the entity association across the contextual domain before concentrating. | "If we had 0 activity for the Church Management System, the topical map would go wider initially." |

**Interaction with existing rules:** NARROW-ROOT vs WIDE-FIRST modulates the *initial publish wave only*. Core-first sequencing (`semantic-content-network` SCN-SQ-02) and the outer-section activation phase (post-maturity second wave) still apply on top. WIDE-FIRST widens the first wave's contextual coverage; it does not mean "Outer before Core."

---

## 3. Page-or-Segment (PoS) — attribute-level URL compression

**[KORAY-OPERATIONAL]** — Koray, seobymarta interview (Nov 2025), stated in a casino context. The attribute-granularity successor to RPP: RPP filters *topics*; PoS decides, per **attribute**, dedicated URL vs in-page segment.

An attribute earns a **dedicated page** (centerpiece or satellite) only when it carries **all four**:

1. **Independent search demand** — its own query network, not just modifier volume.
2. **Commercial value** — monetizable in the property's model.
3. **Conversion potential** — a visitor on this page can plausibly act.
4. **Relational depth** — enough distinct EAV pairs to sustain a standalone document (can rank, collect links, generate its own index value).

**Any factor missing → SEGMENT** inside the broader entity-class page (Koray's examples: "Best Egyptian Theme Slot Games", "Low-Deposit Casinos", "MGA-Licensed Casinos" as segment hosts). Purpose: the most cost-efficient index structure — lower retrieval cost, consolidated ranking signals, stronger network; prevents thin-page inflation, doorway-like URL bloat, and index cannibalization "while maximizing momentum and relevance at scale."

**Map integration:** add a **PoS** column (`page` / `segment: <host page>`) to the Tier 1 map for New Build / zero-history properties. PoS runs in Phase 4 *after* RPP filtering and *alongside* the SERP-Overlap Decision Tree (`site-type-playbooks.md` §1A) — SERP overlap answers "same intent?"; PoS answers "does this attribute justify a URL on a domain where every URL is a paid test?". When they disagree, the stricter (fewer-URLs) verdict wins at launch; revisit at Phase 8 once the property has historical data.

**Consistency note:** this is the same "fewer, deeper pages" bias as the Phase 6 fan-out guardrail (Google AI guide, May 2026) — PoS gives it a per-attribute decision procedure.

---

## 4. Launch URL budget

Derive an explicit **maximum initial URL count** and record it at Checkpoint 1:

```
launch_url_budget = post-PoS page count for the launch wave
sanity band: NARROW-ROOT ≈ 10–30 dense documents; WIDE-FIRST ≈ 30–60
(bands are operator heuristics, not Koray numbers — adjust to niche size; the
binding constraints are PoS output + velocity governance, not the band)
```

The budget interlocks with Tier 3 **velocity governance** (v4.5): a new domain has no baseline, so the launch wave itself sets it — ramp gradually, jitter cadence, never dump the wave in one spike (`algorithmic-authorship-gate` R44 / SCN-SQ-04). Batch-publish of the dependency core is acceptable **[KORAY-OPERATIONAL — his launches front-load a coherent network]**, but the batch must pass the corpus fingerprint layer *before* day one (§6).

---

## 5. Ranking-State KPI ladder

**[KORAY-OPERATIONAL]** — seobymarta interview (Nov 2025). Koray's stated model: sites move through ranking states; for new projects **impressions, not clicks, are the leading KPI**; his stated observation is that around **10,000+ daily impressions, re-ranking begins** and positive ranking states appear; once a site exceeds quality thresholds into a positive state, momentum protects rankings through short-term mistakes until the state changes.

> **Honesty rule:** the 10K/day figure is a single-source practitioner heuristic — present it to users as "Koray's stated trigger heuristic", never as a confirmed Google threshold. Validate per property: check whether the property's own GSC history shows re-ranking inflections clustering near impression levels (serprank/GSC retro-analysis).

| Phase | State | Leading KPI | Do | Don't |
|---|---|---|---|---|
| **A — Pre-trigger** | Initial ranking / testing | **Daily-impressions velocity** across the central-entity query network | Publish the launch wave to plan; hold cadence; measure weekly impression slope | **No click-based edits.** CTR/title tinkering pre-trigger is noise on unstable rankings and burns the initial-ranking anchor |
| **B — Re-ranking active** | Impressions high, positions moving | Impression→click conversion; query-network expansion (new queries entering GSC) | Begin measured on-page iteration; expand from the §7 origin node | Velocity spikes; restructures (SCN-SQ-06) |
| **C — Positive state** | Stable/rising positions, momentum | State maintenance + expansion; standard Phase 8 dashboard takes over | Activate outer-section second wave (SCN addendum); scale cadence | Complacency — states can flip; keep the Phase 8 decay watch |

**Historical data — AI-era addition [KORAY-OPERATIONAL]:** Koray (Sep 2025) projects historical data shifting from impressions/clicks toward **LLM-based citations** (representative-document selection). For new properties, baseline **LLM Citation Share** from day one (DataForSEO LLM Mentions via `classifier-os` Super-System 6 sub-score 6 / serprank collector) and chart it beside the impressions curve — two-curve launch dashboard.

**GSC indexing read (confirmed, Mueller Jul 2026):** rising crawled-/discovered-not-indexed ratios on a new property = site-level quality doubt suppressing crawl/index — a Phase A red flag. Route to `algorithmic-authorship-gate` BATCH (FDS) + PoS consolidation, not to per-URL indexing requests; full page-set triage via `cni-triage`.

---

## 6. Launch gate + skill handoffs

| Concern | Handoff |
|---|---|
| Launch-batch quality floor | `algorithmic-authorship-gate` **NEW-DOMAIN launch profile** (v1.5): raised floors, batch-minimum rule, WARN=HOLD. Rationale = §0.1 initial-ranking anchor. The full launch wave also runs BATCH CFL (FDS) *before* day-one publish. |
| Sequencing / cadence / concentration | `semantic-content-network` SQ launch rules: **SCN-SQ-07** (state-triggered cadence), **SCN-SQ-08** (subfolder-proof concentration), **SCN-SQ-09** (PR-origin expansion). |
| Day-one LLM-citation + impressions baseline | `classifier-os` new-property historical-data lens (v2.3); serprank two-curve collector. |
| Secondary-domain plays (main domain can't penetrate a query network) | `astroturf-serp-os` v1.3 Extension-Domain sub-strategy (do **not** widen this map to chase it — separate property, separate map). |

---

## 7. Expansion-origin rule

**[KORAY-OPERATIONAL]** — "if one of your web pages has a higher PageRank than others, you can start expanding your topical map from the specific node" (Launch article); "Links in Semantics": source-context-aligned PageRank amplifies rankings toward the central query networks; misaligned authority does not.

- Post-launch expansion (Phase B→C) starts from the **highest-PageRank node** (Ahrefs UR / best-available internal proxy; Manual mode: strongest-linked page, labeled `[ESTIMATED]`) — not from the semantically "next" row.
- Early references/PR earned for the property should be **source-context-aligned**; log misaligned high-authority links as low-leverage for the ladder (do not chase them for launch).
- Full network mechanics stay owned by `semantic-content-network` (SCN-SQ-09 executes this rule at the graph level; this file only fixes the map-side expansion order).

**Subfolder-proof variant (weak-history domains) [KORAY-OPERATIONAL]:** perfect one subfolder to state-transition first, then replicate its structural character across sections, forcing evaluation by the best-performing area. Owned by SCN-SQ-08; the map's job is to *pick the subfolder* (highest Retrieval-Confidence cluster with commercial adjacency) and scope wave 1 to it.

---

## 8. Checkpoint 1 declaration block (append when this file applies)

```
LAUNCH CONDITIONS (v4.7)
- BQA state: ASSOCIATED | ZERO  (evidence: …)
- Launch breadth: NARROW-ROOT | WIDE-FIRST
- Launch URL budget: N pages (post-PoS)
- PoS column: ON (page/segment per attribute row)
- KPI ladder: Phase A — impressions velocity; trigger heuristic 10K/day [Koray heuristic, validate per property]
- Day-one baselines: GSC impressions + LLM Citation Share
- Gate route: AAG NEW-DOMAIN profile + pre-launch BATCH FDS
- Expansion origin: <node / subfolder>  (subfolder-proof: YES/NO)
```

---

## Sources

1. seobymarta.com — Koray interview, Nov 2025 (ranking states, impressions-first, 10K/day heuristic, PoS, subfolder-proof)
2. holisticseo.digital/theoretical-seo/ranking/ (initial-ranking irreversibility)
3. medium.com/@ktgubur — "How to Launch a Semantic Content Network", Jan 2024 (conditional breadth, 15-doc case, PR-node expansion)
4. x.com/KorayGubur/status/1957199420594032953 — CMSEO 2024 (Cost of Retrieval, PageRank per Page, launch economics)
5. medium.com/@ktgubur — "Thoughts on AI Search and AI-based SEO", Sep 2025 (historical data → LLM citations)
6. medium.com/@ktgubur — "3 Suggestions about Topical Authority" (Links in Semantics, source-context-aligned PageRank)
7. seroundtable.com/google-crawled-not-indexed-quality-ai-content-41701.html — Mueller/Splitt, Jul 2026 (quality-gated crawl/index suppression)
8. Internal research dossier: `docs/research/koray-new-site-launch-mechanics-2026-07-16.md`
