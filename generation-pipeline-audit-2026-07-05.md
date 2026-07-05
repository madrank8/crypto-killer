# Generation Pipeline Audit — Reviews + Posts + Prompt Canon
**Date:** 2026-07-05 · **Scope:** review pipeline, article pipeline, prompts vs ai-brain canon
**Method:** 3 parallel deep audits (full file reads) of crypto-killer-app + `~/Documents/GitHub/ai-brain` skills

## Verdict

The pipeline architecture is strong (source ledger, deterministic citation filtering, multi-stage writers, publish gates), but there are **6 P0 issues shipping wrong or risky content today**, **~20 P1 bugs** including bypassable publish gates and dead validators, and the prompts have drifted **~6 versions behind ai-brain canon** (reviews claim "v4.1 parity", canon is seo-blog-generator v5.2.0). The single most dangerous pattern: several quality mechanisms *look* wired but are inert (validate-publish never called, category-distinctness always no-ops, velocity consistency key-mismatched, visual pipeline scans the wrong field).

---

> **STATUS UPDATE (same day):** All 6 P0s FIXED + independently review-verified (Wave 1 complete, awaiting push).
> R1/R2 tier-gated copy + ledger-driven regulator badges · R3 prompt contradictions resolved · R4 sync route gated + validate-publish wired + regen demotes to draft · R5 missing-audit now blocks publish · A1 visual pass runs on built HTML + placeholder publish gates (reviews + content) · A2 VERIFY tags emit honest Claim nodes.
> **Replit follow-up:** blog renderer should be checked for `.claimReviewed` assumptions on `content.claims` (now Claim nodes with `.text`).

## P0 — shipping broken/risky content NOW (fixed, kept for reference)

**R1. Hardcoded scam copy on ALL threat tiers** (`generate/route.js:902-905,1151`)
"Confirms every hallmark of a confidence scheme", "you have been targeted by an organized fraud operation", "**Do not deposit any money**" are baked into full_article regardless of tier. "Do Not Deposit" is on the banned list for non-confirmed tiers, but the sync scrub never touches full_article body. Defamation exposure on every watchlist/low review.
→ Gate these blocks on `threat.frameAsScam`.

**R2. Fake "FCA/SEC/ASIC/CySEC: None" sidebar** (`generate/route.js:1134-1141`)
Four static ✕ badges regardless of what the regulator lookups actually found. Can assert "FCA: None" when the FCA lookup found a warning. Factually false claims about regulators on YMYL pages.
→ Render badges from sourceLedger regulator lookup results.

**R3. Prompts mandate what the auditor hard-fails** (`review-pipeline.js:322,324` vs auditor)
Trust stage REQUIRES "bank chargeback within 60 days" and "500+ campaigns" — both are the auditor's canonical `fabricated_source_or_stat` HARD FAIL examples. Every multi-agent review is born audit-flagged (or the auditor is leaking).
→ Use `{{platform_stat:total_brands_tracked}}` + hedged chargeback wording (mono prompt already fixed this; multi-agent regressed).

**R4. Publish gate bypassable 3 ways** (`[id]/sync/route.js`, `validate-publish` orphaned, regen keeps published)
(a) Manual Sync ships to Replit with zero gate. (b) validate-publish (8 deterministic checks incl. CELEB_COUNT_DRIFT) is called by NOTHING. (c) Regenerating a published review keeps status=published and clears the previous audit VETO — fresh unaudited content stays live.
→ Gate sync route; wire validate-publish into publish; demote regenerated published reviews to draft until re-audited.

**A1. Articles publish literal grey placeholder boxes** (`fill/route.js:261-281` + `article-html.js:212-256`)
Visual processor scans section bodies for placeholders; the section writer is forbidden to put them there; aux returns them separately; article-html injects them as visible `[CHART: …]` boxes; the publish gate doesn't check. Straight outline→fill→publish ships placeholder boxes to production.
→ Run visuals on the built HTML (or aux placeholders); add placeholder check to validateForPublish.

**A2. Fabricated "Verified" fact-checks in schema** (`schema-enrichment-resolver.js:245-257`)
Every `{{VERIFY: …}}` tag (= "needs human confirmation") becomes ClaimReview `ratingValue:5 "Verified"` — nobody verifies them. Fabricated structured data on YMYL; the intended debunk-claims (ratingValue:1) path is unreachable.
→ Emit `Claim` not `ClaimReview` for unverified; restore debunk claims via aux prompt.

## P1 — top bugs (full detail in agent findings below)

- **A3. Fill never persists `target_keyword`, `author_persona_id`, `alternative_headline`** — every article since the pipeline migration ships without its keyword and persona metadata. (fill/route.js:439-474)
- **R5. Audit-skip = audit-pass** — auditor error → `audit_hard_fail:false`, `audit_score:null` → publish gate treats NaN as pass. Same class in articles (fill:361-369). → Missing audit must block publish.
- **R6. Polish race** — no concurrency guard despite comment claiming one; double-polish corrupts full_article. → conditional PATCH `generation_status=neq.polishing`.
- **R7. Slug-collision fallback can overwrite ANOTHER brand's review** (generate:1396-1414). → verify brand_id before PATCH, else re-suffix slug.
- **R8. runStage accepts max_tokens-truncated JSON as success** — amputated content ships silently. → treat stopReason==='max_tokens' as stage failure.
- **R9. Core-retry replaces whole core object** — can drop red_flags entirely; `>=` acceptance lets duplicated stage text pass (root cause of whatsapp-bot Stage-4 dup, together with the `^`-anchored label strip at generate:958).
- **R10. Dead validators**: velocity consistency key mismatch (`velocity` vs `velocity7d`), red-flag category check reads a field no prompt emits, headline "{N} Red Flags" count never reconciled with actual flags (Floventra-class self-contradiction).
- **R11. Celebrity count drift regression** — funnel stage card uses raw `total_celebrities`, sidebar uses deduped count (sync-shape:867 vs 1111).
- **R12. FCA Warning List false positives** — bare HTTP 200 on a slug URL asserted as "FCA added {brand} to Warning List". → require brand name in body.
- **R13. Gemini grounding-redirect URLs leak into visible sources[]** (blocked in citations only).
- **R14. Prompt injection surface** — scraped ad creative names and researched web extracts interpolated into writer prompts un-delimited. → fence + truncate untrusted fields.
- **R15. Publish flips status before Replit sync, no rollback** — DB says published, live site never got it; returns success:true.
- **R16. Title truncation bug (known)** — blind `substring(0,60)` in editor + `slice(0,110)` in sync-shape leave trailing connectors ("…and | CryptoKiller"). → boundary-aware truncator.
- **A4. Two incompatible shapes for how_to/item_list/claims/quotes** across legacy vs resolver paths, and content sync has no normalizer (reviews have sync-shape; content ships raw).
- **A5. Quote/HowTo extractors parse HTML but sections are markdown** — `quotes` nearly always empty.
- **A6. Re-running fill destroys outline context** — second-gen articles written from headings alone. → persist outline separately.
- **A7. Section writers never see sourceLedger or platform-stat tokens** — the information-gain mandate is unreachable in body prose.
- **A8. Timeouts hard-block publish** — gov sites (sec.gov, ic3.gov) time out at 5s and are misclassified as dead. → only DNS/404/410 hard-dead; 10s timeout.
- **A9. VERIFY spans leak into published HTML; inline WARNING/TIP callouts get deleted** (strip order bug).
- **A10. Topical map's `page_role`/`macro_vector`/keyword enrichment generated then thrown away** — Opus paid for a semantic plan nothing consumes.

## Prompt drift vs ai-brain canon (agent 3)

**Implemented well:** fabrication prohibition (stronger than canon — deterministic ledger filtering), source ledger, BLUF, Koray EAV/declaration-first/3-example, extractive FAQ answers, information-gain hard fail, visual placeholder minimums, Koray 7-check + voice audit in auditor.

**Missing from canon:**
- v5.2 global 4-tier banned-phrase system (603 entries) — deployed lint has 45 regexes; dozens of exact canonical phrases unlinted; `let's dive into` regex bug
- Step 6.8 **AI Disclosure block — canon marks MANDATORY/HARD FAIL** — nowhere in either pipeline
- algorithmic-authorship-gate v1.4 — zero implementation, and canon flags CryptoKiller's 11k-review corpus as its most critical target (R15 cross-doc dedup)
- **Worse: the pipeline actively manufactures the fingerprint canon warns about** — hardcoded title/headline templates, identical 4 stage labels + 4 FAQ questions on every review = R42/R43 scaled-content-abuse signals
- review-quality-gate weighted scoring (L2 category sub-scores "cap at 45 if single overall score" — CryptoKiller ships exactly one overall score), L3 comparables, L8 template-replication check
- Google Discover mode: canon rates CryptoKiller "best fit"; repo has no Discover lane and its 150-word-answer rule is the exact inverse of Discover's delayed-answer structure (additive fix: new content_type)
- semantic-content-engine SC-008 (certainty modality), SC-032 (Q&A word-order match), SC-033

**Version strings:** review prompts claim "v4.1 full skill parity" — canon is v5.2.0 (~6 versions of additions missing).

## Model pins (mostly healthy)
June's "1-2 generations old" issue is fixed (opus-4-8/sonnet-4-6/haiku-4.5 current). Remaining: auditor gate runs sonnet→haiku (haiku can be sole publish gate; prompt header still claims GPT-5.4 Mini); `callOpenAI` sends `max_tokens` instead of `max_completion_tokens` for GPT-5.x (likely why the cross-vendor audit pin was abandoned — one-line fix); aux writer (whole SEO/schema payload) is Haiku-primary → promote to Sonnet; outline runs at effort:low; keyword/source research rides a *preview* Gemini pin.

## Recommended fix order

**Wave 1 — truth & safety (P0):** R1, R2, R3, A2, A1, R4
**Wave 2 — gate integrity:** R5, R6, R7, R8, R9, R15, A3, A6
**Wave 3 — dead validators & consistency:** R10, R11, R16, A4, A5, A8, A9
**Wave 4 — canon sync:** unified kill-list module (fixes 4 divergent copies), v5.2 banned phrases, AI-disclosure block, skeleton archetype rotation (anti-fingerprint), weighted auditor scoring + category sub-scores, `max_completion_tokens` fix + cross-vendor auditor, SC-008/032/033 lines
**Wave 5 — new capability:** Discover content_type, L3 comparables block, per-category threat sub-scores, feed sourceLedger to section writers, persist topical-map semantics

Full agent reports (37 + 21 + drift findings with file:line) available in conversation; this file is the executive index.
