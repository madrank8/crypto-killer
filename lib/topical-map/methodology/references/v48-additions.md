# v4.8 Additions — Full Specs

Eight deliverable/QA upgrades adopted from an Audit-Mode teardown of a strong commercial Koray-framework map (CryptoKiller.org, by Growth Partner — full audit + DataForSEO cross-checks saved in the Crypto Killer Claude project). The SKILL.md body carries one-line pointers; this file holds the complete specifications.

---

## §A — Key Findings from the Data (Tier 1, mandatory)

5–7 strategic insights placed BEFORE the map table that justify the architecture. Cover at minimum:

1. What share of the keyword universe is rejected noise and why
2. The single biggest demand gap
3. Which cluster bridges to the money pages (state the bridge logic in one sentence — see §D)
4. The trending/momentum engine
5. The site's moat asset (data, tool, or function AI content cannot replicate)

The reader must be able to understand the strategy without decoding the table. Our outputs previously jumped straight to structure and made the reader infer the strategy; the narrative layer is what makes the map persuasive and executable by someone who didn't build it.

## §B — Reject List (Tier 1, mandatory)

A named deliverable — separate XLSX sheet / Markdown section, not an internal filtering step — listing every rejected topic category with volume context and a one-sentence reason tied to the topical border (siteFocusScore / siteRadius / source-context mismatch).

**Format:** category → example queries with volume → why publishing would dilute topical authority.

This is both border documentation and the most persuasive artifact in the deliverable: it shows the discipline behind what was *not* mapped, and protects future editors from re-adding volume-tempting noise.

## §C — Journey-Stage Organization (Phase 2 step 5)

If the Central Search Intent has distinct pre/post phases (verify-before vs recover-after; pre-purchase vs post-purchase; plan vs troubleshoot), define it as a **two-phase intent network** and organize Core sub-sections by journey stage rather than by entity taxonomy alone.

Demand frequently concentrates in the post-phase that sites neglect — check both phases before assuming the map's center of gravity. (Source case: a scam-checking site whose search demand was dominated by post-scam queries — reporting, recovery, tracing — that the pre-scam-focused site didn't cover.)

**Deliverable addition:** the Phase 2 summary records the journey-stage decision (single-phase or two-phase, with reasoning).

## §D — Bridge Cluster Tag (Phase 4 step 11; Tier 1 column)

Identify the cluster(s) whose pages link most directly into the money pages — the shortest internal-link path from informational demand to monetization. Tag those topics `BRIDGE` in the Bridge Tag column and weight them UP one priority tier in RPP, all else equal: a medium-volume topic that feeds PageRank straight into revenue pages outranks a higher-volume topic three hops away.

State the bridge logic in one sentence in Key Findings (§A item 3).

## §E — Trending Node Lifecycle Rule (Phase 6 + Phase 8)

Each Trending Node publishes during its demand spike at a **dateless URL**, then is **evergreen-ified** after the spike — content updated, reframed from news to reference, linked up into its evergreen hub — rather than sunset by default.

If the map includes a rolling trending section, state a **committed cadence** (e.g., 2–4/month): the rolling section is a historical-data engine, not a one-off.

**Phase 8 interaction:** before sunsetting any Trending Node, apply this rule first. Evergreen-ify is the default disposition; sunset only when no evergreen reframe exists.

## §F — Orphan-Reference Check (Phase 5.7)

Every URL or page named anywhere in the map's Internal Links / connection-logic columns MUST exist as a map row, or be explicitly flagged `[REFERENCED — NOT MAPPED]` with a disposition (add as row / already exists on site / drop the reference).

**Common orphans:** /methodology, /about, /report or tool pages, index/hub pages, author pages.

**E-E-A-T rule:** pages that carry the site's trust positioning (methodology, evidence standards, organization/author entities) are REQUIRED Core rows when the site makes trust claims — a map whose strategy depends on unmapped pages is incomplete.

**Hub-before-spokes rule:** verify the hub/pillar of every Phase-1 spoke cluster is published no later than its spokes (a thin v1 hub is acceptable); spokes with no hub to link up to waste early internal-link consolidation.

**Deliverable addition:** the Phase 5 cannibalization report includes orphan-reference dispositions.

## §G — Cross-Source Volume Verification (Honesty Rule 9)

In Tool-Assisted and Audit modes, spot-verify 8–12 representative keywords (including every headline/flagship volume claim) against a second data source (e.g., DataForSEO vs Semrush/Ahrefs) before finalizing. Flag:

- **(a) Cluster-inflated volumes** — a phrase carrying its parent cluster's volume (e.g., a long-tail variant "showing" 49,500/mo that actually belongs to the head term; caught live in the source audit).
- **(b) Declining flagships** — priority topics whose trend is down >50% YoY get a `[DECLINING]` marker and tempered momentum expectations.
- **(c) Unverifiable trending volumes** — trending-term figures absent from the second source are labeled `[SINGLE-SOURCE — directional]`, never presented as confirmed.

## §H — Template-Separation Notes (Phase 6)

Where the map contains page classes with different trust contexts — legit-brand safety reports vs scam investigations; editorial reviews vs sponsored listings; medical reference vs commerce — flag each class for a **visually distinct template** so users and quality raters never conflate them. Record the flag in the Notes column (`template:<class>`).

---

**Checklist:** the SKILL.md Quality Checklist § "v4.8 Deliverable Upgrades" enumerates the pass conditions for all eight.
