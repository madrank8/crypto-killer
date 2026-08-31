# Remediation execution report — 2026-08-31

**End state: every canonical-gate failure resolved (34/34 → 0/34), all 33 published
investigations current on production.** 651/651 tests pass.

## What ran, in order

1. **Detector calibration against the corpus.** Before touching prose, all 30 flagged
   "fraud assertions" were classified against their real contexts: 16 were false positives
   (negated thresholds, "whether X is a scam" questions, attributed statements, corpus
   references, and "Crypto Killer is a scam intelligence platform"). Guards added +
   regression-tested; only genuine violations were ever softened.

2. **Deterministic remediation, three passes** (`scripts/remediate-investigations.mjs`,
   transforms unit-tested in `lib/remediation.js`): ~950 edits across scores, "N/100"
   literals (prose + schema JSON + disclaimers), metric literals (inline-tag tolerant,
   platform-context aware), stale observation windows moved together with their
   day-counts, register softening, and structured-field (dataset / item_reviewed /
   internal_links) literals. Passes 2-3 closed blind spots the deployed LLM auditor
   caught (experience_signals, disclaimers, jsonb fields) — and two auto-fix features
   were **reverted on my own dry-run review** (item_list completion would have added
   cross-script duplicate people; bare "N ads" matching corrupted subset sentences —
   both now guarded or dropped).

3. **Evidence recording + claim verification** (every URL fetched live before attaching):
   - **quantum-ai → legitimately CONFIRMED**: FCA warning verified; recorded as
     regulator evidence + `primary_domain=quantumai.co`. Confirmed language kept.
   - **trade-vector-ai**: genuine FCA warning found (published 2025-09-19, domain
     trade-vectorai.net) → sourced the "FCA has warned" claim + brand evidence recorded.
   - **whatsapp-bot**: SEC 2025-144 ($14M WhatsApp scheme) and the Kyle Holder $300k CBS
     case both verified real and sourced; ASIC 26-157MR (2026) + Austrian FMA (2025)
     warnings sourced for the category claim.
   - **quarix-ai**: ASIC 24-180MR located; the article's paraphrase-as-quote aligned to
     the verbatim text; FINMA/CySEC register URLs attached; 3 Wayback landing-page
     snapshots attached as first-party evidence.
   - **primeaura**: Traders Union review + HackAware investigation verified and sourced;
     the **Crypto Legal listing could not be verified** (no such entry on cryptolegal.uk)
     → removed from article and red flag, replaced in the convergence claim by the
     verified HackAware investigation.
   - **kaspi-ai**: claimed Kazakhstan police warning NOT verifiable (sources are portal
     homepages) → language softened; analyst flag stands.
   - Unverifiable pattern specifics softened: nordiqo ($250 / 300-500% / $500–$5k),
     quarix + trade-vector ("60-day dispute window" → varies-by-network wording).

4. **Deployed pipeline runs**: 13 Polish cycles across the 9 gate-blocked reviews
   (auto quality-fix agent included). **whatsapp-bot passed clean (74, no veto)** and
   synced normally.

5. **The stopping point, and why.** After two full cycles the auditor's residuals
   rotate within one structural class: item_list completeness (blocked by cross-script
   duplicate names), research-ledger plumbing (a generation-time structure, distinct
   from `sources[]`), and first-party surveillance specifics that need `{{stat:}}`
   tokens by construction. All are **writer-regeneration work** — more surgery would
   strip the first-party specificity that is the site's competitive advantage.

6. **Operator-approved force-sync** (Niro, 2026-08-31): the 8 remaining reviews were
   force-synced past the audit veto — logged per review — because their live copies had
   every flaw the vetoes describe PLUS wrong scores/metrics. All 8 shipped with
   hash-verified payloads. Live spot-checks: floventra shows 16/100 with the
   verification directive; senvix meta 47/100 · 18 countries · 107 figures.

## Audit-state ledger (deployed auditor, cycle 2)

| Review | Score | Veto | Residual class |
|---|---|---|---|
| whatsapp-bot | 74 | **cleared** | — |
| immediate-bienestar | 74 | yes | velocity narrative vs velocity=0; item fields |
| quarix-ai | 74 | yes | research-ledger plumbing (sources[] not read as ledger) |
| affitto-casa-immobiliare | 72 | yes | first-party experiential specifics need tokens |
| nordiqo | 72 | yes | item_list missing 1 name; register-narrative |
| floventra | 71 | yes | item_list 27 vs 31 |
| primeaura | 71/81 | yes | item_list 56 vs 166; ledger |
| trade-vector-ai | 71 | yes | item_list 65 vs 136 |
| prestara-nexor | 61 | yes | velocity narrative; item_list 19 vs 26 |

## Code changes shipped this session (in the repo, awaiting push)

- `lib/remediation.js` + `scripts/remediate-investigations.mjs` — the remediation engine
- `scripts/attach-verified-sources.mjs`, `scripts/fix-claims-pass3.mjs`, `fix-claims-pass4.mjs`
- `lib/editorial-language.js` — corpus-calibrated non-assertive guards; conditional
  directives ("do not deposit **without** verification") recognised as the correct register
- `lib/review-integrity.js` — celebrity comparisons now use the canonical deduped+split
  count (fixes the deployed gates fighting each other: raw tally 51 vs 61 real people)
- `lib/investigation-validator.js` — scans experience_signals + information_gain_summary
- 40 new tests (651 total)

## Handoff additions (Replit)

- The score BOX and one geo widget render from Replit-side stored fields/cache
  (senvix box still said 50 after the payload shipped 47) — renderer must read the
  payload's canonical fields everywhere.
- "Status: Active Scam" label renders on a 16/100 LIMITED-EVIDENCE page (floventra) —
  another score-independent label that must follow `threat_classification`.

## Open items

1. **Niro: push via GitHub Desktop** — activates evidence-gated classification,
   the fixed integrity checker, and the validator across the deployed pipeline.
2. **Wave-2 regeneration** of the 8 vetoed reviews through the (post-push) writer —
   clears the structural residuals properly. Priority: the 5 band-crossers.
3. kaspi-ai GOV.KZ warning URL (restores its stronger claim); FI direct alert URL
   for primeaura (upgrades the Traders-Union-attributed blacklist claim to REGULATORY).
4. Translations still carry pre-remediation copies — re-run from corrected masters.
5. Replit renderer per the handoff (now with two concrete reproduction cases).
