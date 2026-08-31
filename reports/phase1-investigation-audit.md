# Investigation dataset audit — Phase 1

Generated 2026-08-31T09:53:35.020Z against 34 investigations.

**Read-only.** No row was modified. Every entry below needs a human decision, and the
recommended action is a suggestion, not something the tooling applied.

- Investigations that would FAIL the publish gate today: **34 / 34**
- Investigations with zero findings: **0**

## Findings by code

| Severity | Code | Count |
|---|---|---:|
| critical | `METRIC_LITERAL_DRIFT` | 79 |
| warning | `PRIMARY_DOMAIN_MISSING` | 34 |
| critical | `SCORE_DRIFT` | 32 |
| warning | `METRIC_HARDCODED` | 22 |
| critical | `DEFINITIVE_CLAIM_UNSUPPORTED` | 21 |
| warning | `AMBIGUOUS_PARAGRAPH_OPENER` | 8 |
| warning | `DUPLICATE_TEXT_BLOCK` | 5 |
| critical | `METRIC_SELF_CONTRADICTION` | 2 |
| critical | `STRONG_CLAIM_UNSOURCED` | 2 |
| warning | `CONFIRMED_EVIDENCE_SHORTFALL` | 1 |

## Internal-link opportunities (page types that do not exist yet)

No links were created for these. Recorded here as Phase 2 scope.

| Wanted page type | Links it would carry |
|---|---:|
| `public_figure` | 146 |
| `country` | 115 |

## Per-investigation detail

### `/review/affitto-casa-immobiliare`

Status: published · score 6/100 (live brand 7) · LIMITED_EVIDENCE · publishable today: **NO**

| Severity | Issue | Field | Current value(s) | Recommended action |
|---|---|---|---|---|
| critical | `SCORE_DRIFT` — The investigation asserts 6/100 while the live brand score is 7/100 (delta +1). The page states a threat level our own surveillance data no longer supports. Re-score and regenerate rather than editing one copy. | `threat_score` | {"investigation":6,"live_brand":7,"delta":1} | Decide which score is true, then make BOTH agree in one pass: either re-run the score sync and regenerate the article against the new number, or freeze the brand score. Never edit one copy alone. |
| critical | `METRIC_LITERAL_DRIFT` — Prose states 26 days active but the canonical value is 153 (full_article). Interpolate from the canonical record instead of typing the number. | `days_active` | [26] | Regenerate through the writer, which emits {{stat:…}} tokens by construction. Do not hand-edit the number. |
| critical | `DEFINITIVE_CLAIM_UNSUPPORTED` — "Do not deposit" instructs the reader as though the platform were established as unsafe, but this investigation is classified LIMITED_EVIDENCE (6/100), where the page also states that the evidence is not sufficient. State plainly that current evidence is insufficient to classify the entity as a confirmed scam. Do not imply fraud. | `full_article` | ✕ SEC: None ✕ ASIC: None ✕ CySEC: None ⛔ Final Verdict Affitto Casa Immobiliare shows limited signals. Ongoing monitoring. Do not deposit any money. Based on an | Soften the wording to the classification’s register, or record the regulator warning / victim reports that would justify it. |
| warning | `METRIC_HARDCODED` — 2 countries targeted matches the canonical value today but is a literal in meta_description and will drift the next time the scraper runs. | `countries_targeted` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `METRIC_HARDCODED` — 3 public figures impersonated matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `public_figures_impersonated` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `METRIC_HARDCODED` — 71 creatives observed matches the canonical value today but is a literal in meta_description and will drift the next time the scraper runs. | `creatives_observed` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `PRIMARY_DOMAIN_MISSING` — No primary domain recorded. 9 landing hostname(s) observed, but those are cloaked ad landers and must be confirmed by an analyst before publication — top candidate: portafoglio.protocollo-finanziario.it. | `primary_domain` | ["portafoglio.protocollo-finanziario.it","analisi.flash-notizie-it.com","capitaleplus.protocollo-finanziario.it","consulenza.riscatto-italiano.it","cultura.flas | An analyst must confirm the platform’s own domain. Landing hostnames are cloaked landers and must not be used. |

### `/review/afriquant-ai`

Status: published · score 13/100 (live brand 3) · LIMITED_EVIDENCE · publishable today: **NO**

| Severity | Issue | Field | Current value(s) | Recommended action |
|---|---|---|---|---|
| critical | `SCORE_DRIFT` — The investigation asserts 13/100 while the live brand score is 3/100 (delta -10). The page states a threat level our own surveillance data no longer supports. Re-score and regenerate rather than editing one copy. | `threat_score` | {"investigation":13,"live_brand":3,"delta":-10} | Decide which score is true, then make BOTH agree in one pass: either re-run the score sync and regenerate the article against the new number, or freeze the brand score. Never edit one copy alone. |
| critical | `METRIC_LITERAL_DRIFT` — Prose states 30 creatives observed but the canonical value is 48 (full_article). Interpolate from the canonical record instead of typing the number. | `creatives_observed` | [30] | Regenerate through the writer, which emits {{stat:…}} tokens by construction. Do not hand-edit the number. |
| critical | `DEFINITIVE_CLAIM_UNSUPPORTED` — "is a fraudulent scheme" states fraud as settled fact, but this investigation is classified LIMITED_EVIDENCE (13/100). State plainly that current evidence is insufficient to classify the entity as a confirmed scam. Do not imply fraud. | `full_article` | authorities before acting. Ongoing monitoring continues. 📖 Frequently Asked Questions Is AfriQuant AI a legitimate trading platform? No. AfriQuant AI is a frau | Soften the wording to the classification’s register, or record the regulator warning / victim reports that would justify it. |
| warning | `PRIMARY_DOMAIN_MISSING` — No primary domain recorded. 4 landing hostname(s) observed, but those are cloaked ad landers and must be confirmed by an analyst before publication — top candidate: thrynexis.com. | `primary_domain` | ["thrynexis.com","vorythix.com","myrthex.com","pyrisan.com"] | An analyst must confirm the platform’s own domain. Landing hostnames are cloaked landers and must not be used. |

### `/review/blackrose-finbitnex`

Status: published · score 25/100 (live brand 26) · UNDER_INVESTIGATION · publishable today: **NO**

| Severity | Issue | Field | Current value(s) | Recommended action |
|---|---|---|---|---|
| critical | `SCORE_DRIFT` — The investigation asserts 25/100 while the live brand score is 26/100 (delta +1). The page states a threat level our own surveillance data no longer supports. Re-score and regenerate rather than editing one copy. | `threat_score` | {"investigation":25,"live_brand":26,"delta":1} | Decide which score is true, then make BOTH agree in one pass: either re-run the score sync and regenerate the article against the new number, or freeze the brand score. Never edit one copy alone. |
| critical | `METRIC_LITERAL_DRIFT` — Prose states 217 days active but the canonical value is 324 (full_article). Interpolate from the canonical record instead of typing the number. | `days_active` | [217] | Regenerate through the writer, which emits {{stat:…}} tokens by construction. Do not hand-edit the number. |
| critical | `METRIC_LITERAL_DRIFT` — Prose states 61 public figures impersonated but the canonical value is 76 (meta_description). Interpolate from the canonical record instead of typing the number. | `public_figures_impersonated` | [61] | Regenerate through the writer, which emits {{stat:…}} tokens by construction. Do not hand-edit the number. |
| critical | `METRIC_LITERAL_DRIFT` — Prose states 312 creatives observed but the canonical value is 314 (meta_description). Interpolate from the canonical record instead of typing the number. | `creatives_observed` | [312] | Regenerate through the writer, which emits {{stat:…}} tokens by construction. Do not hand-edit the number. |
| critical | `DEFINITIVE_CLAIM_UNSUPPORTED` — "Do not deposit" instructs the reader as though the platform were established as unsafe, but this investigation is classified UNDER_INVESTIGATION (25/100), where the page also states that the evidence is not sufficient. Observed warning signals may be described. Unverified fraud claims must not be stated as established fact. | `full_article` | : None ✕ ASIC: None ✕ CySEC: None ⛔ Final Verdict Blackrose Finbitnex is under active investigation. Verify before depositing. Do not deposit any money. Based o | Soften the wording to the classification’s register, or record the regulator warning / victim reports that would justify it. |
| warning | `METRIC_HARDCODED` — 11 countries targeted matches the canonical value today but is a literal in alternative_headline and will drift the next time the scraper runs. | `countries_targeted` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `PRIMARY_DOMAIN_MISSING` — No primary domain recorded. 18 landing hostname(s) observed, but those are cloaked ad landers and must be confirmed by an analyst before publication — top candidate: brokjawnightsalmon.com. | `primary_domain` | ["brokjawnightsalmon.com","noisetextbookmale.com","chickprinterschool.com","enchantedriddle.info","faithfulness.organiccheek.com"] | An analyst must confirm the platform’s own domain. Landing hostnames are cloaked landers and must not be used. |

### `/review/capbit`

Status: published · score 12/100 (live brand 3) · LIMITED_EVIDENCE · publishable today: **NO**

| Severity | Issue | Field | Current value(s) | Recommended action |
|---|---|---|---|---|
| critical | `SCORE_DRIFT` — The investigation asserts 12/100 while the live brand score is 3/100 (delta -9). The page states a threat level our own surveillance data no longer supports. Re-score and regenerate rather than editing one copy. | `threat_score` | {"investigation":12,"live_brand":3,"delta":-9} | Decide which score is true, then make BOTH agree in one pass: either re-run the score sync and regenerate the article against the new number, or freeze the brand score. Never edit one copy alone. |
| warning | `PRIMARY_DOMAIN_MISSING` — No primary domain recorded. 8 landing hostname(s) observed, but those are cloaked ad landers and must be confirmed by an analyst before publication — top candidate: wafaluremied.xyz. | `primary_domain` | ["wafaluremied.xyz","enoruekavel.info","zolpaerani.info","firaenyodela.xyz","vesomiratu.pro"] | An analyst must confirm the platform’s own domain. Landing hostnames are cloaked landers and must not be used. |

### `/review/crest-fundgrove`

Status: published · score 15/100 (live brand 5) · LIMITED_EVIDENCE · publishable today: **NO**

| Severity | Issue | Field | Current value(s) | Recommended action |
|---|---|---|---|---|
| critical | `SCORE_DRIFT` — The investigation asserts 15/100 while the live brand score is 5/100 (delta -10). The page states a threat level our own surveillance data no longer supports. Re-score and regenerate rather than editing one copy. | `threat_score` | {"investigation":15,"live_brand":5,"delta":-10} | Decide which score is true, then make BOTH agree in one pass: either re-run the score sync and regenerate the article against the new number, or freeze the brand score. Never edit one copy alone. |
| critical | `METRIC_LITERAL_DRIFT` — Prose states 32 days active but the canonical value is 97 (full_article). Interpolate from the canonical record instead of typing the number. | `days_active` | [32] | Regenerate through the writer, which emits {{stat:…}} tokens by construction. Do not hand-edit the number. |
| critical | `METRIC_LITERAL_DRIFT` — Prose states 9 public figures impersonated but the canonical value is 13 (full_article). Interpolate from the canonical record instead of typing the number. | `public_figures_impersonated` | [9] | Regenerate through the writer, which emits {{stat:…}} tokens by construction. Do not hand-edit the number. |
| critical | `METRIC_LITERAL_DRIFT` — Prose states 47 creatives observed but the canonical value is 69 (full_article). Interpolate from the canonical record instead of typing the number. | `creatives_observed` | [47] | Regenerate through the writer, which emits {{stat:…}} tokens by construction. Do not hand-edit the number. |
| critical | `DEFINITIVE_CLAIM_UNSUPPORTED` — "Do not deposit" instructs the reader as though the platform were established as unsafe, but this investigation is classified LIMITED_EVIDENCE (15/100), where the page also states that the evidence is not sufficient. State plainly that current evidence is insufficient to classify the entity as a confirmed scam. Do not imply fraud. | `full_article` | CA: None ✕ SEC: None ✕ ASIC: None ✕ CySEC: None ⛔ Final Verdict Crest Fundgrove shows limited signals. Ongoing monitoring. Do not deposit any money. Based on an | Soften the wording to the classification’s register, or record the regulator warning / victim reports that would justify it. |
| warning | `PRIMARY_DOMAIN_MISSING` — No primary domain recorded. 9 landing hostname(s) observed, but those are cloaked ad landers and must be confirmed by an analyst before publication — top candidate: gwemikazrol.pro. | `primary_domain` | ["gwemikazrol.pro","canadnewsroomt365.com","currentaffairs24.com","meridantiro.com","radiantless.top"] | An analyst must confirm the platform’s own domain. Landing hostnames are cloaked landers and must not be used. |

### `/review/equiloompro`

Status: published · score 43/100 (live brand 34) · ELEVATED_RISK · publishable today: **NO**

| Severity | Issue | Field | Current value(s) | Recommended action |
|---|---|---|---|---|
| critical | `SCORE_DRIFT` — The investigation asserts 43/100 while the live brand score is 34/100 (delta -9). The page states a threat level our own surveillance data no longer supports. Re-score and regenerate rather than editing one copy. | `threat_score` | {"investigation":43,"live_brand":34,"delta":-9} | Decide which score is true, then make BOTH agree in one pass: either re-run the score sync and regenerate the article against the new number, or freeze the brand score. Never edit one copy alone. |
| critical | `METRIC_LITERAL_DRIFT` — Prose states 184 days active but the canonical value is 318 (full_article). Interpolate from the canonical record instead of typing the number. | `days_active` | [184] | Regenerate through the writer, which emits {{stat:…}} tokens by construction. Do not hand-edit the number. |
| critical | `METRIC_LITERAL_DRIFT` — Prose states 17 countries targeted but the canonical value is 20 (alternative_headline). Interpolate from the canonical record instead of typing the number. | `countries_targeted` | [17] | Regenerate through the writer, which emits {{stat:…}} tokens by construction. Do not hand-edit the number. |
| critical | `METRIC_LITERAL_DRIFT` — Prose states 54 public figures impersonated but the canonical value is 99 (full_article). Interpolate from the canonical record instead of typing the number. | `public_figures_impersonated` | [54] | Regenerate through the writer, which emits {{stat:…}} tokens by construction. Do not hand-edit the number. |
| critical | `METRIC_LITERAL_DRIFT` — Prose states 342 creatives observed but the canonical value is 398 (meta_description). Interpolate from the canonical record instead of typing the number. | `creatives_observed` | [342] | Regenerate through the writer, which emits {{stat:…}} tokens by construction. Do not hand-edit the number. |
| warning | `PRIMARY_DOMAIN_MISSING` — No primary domain recorded. 15 landing hostname(s) observed, but those are cloaked ad landers and must be confirmed by an analyst before publication — top candidate: threnoxavelia.com. | `primary_domain` | ["threnoxavelia.com","zenithmaxisynergix.com","falverostniz.sbs","arakitrniopnt.com","branelovita.com"] | An analyst must confirm the platform’s own domain. Landing hostnames are cloaked landers and must not be used. |

### `/review/fino-inversor-a`

Status: published · score 17/100 (live brand 8) · LIMITED_EVIDENCE · publishable today: **NO**

| Severity | Issue | Field | Current value(s) | Recommended action |
|---|---|---|---|---|
| critical | `SCORE_DRIFT` — The investigation asserts 17/100 while the live brand score is 8/100 (delta -9). The page states a threat level our own surveillance data no longer supports. Re-score and regenerate rather than editing one copy. | `threat_score` | {"investigation":17,"live_brand":8,"delta":-9} | Decide which score is true, then make BOTH agree in one pass: either re-run the score sync and regenerate the article against the new number, or freeze the brand score. Never edit one copy alone. |
| critical | `METRIC_LITERAL_DRIFT` — Prose states 111 days active but the canonical value is 164 (full_article). Interpolate from the canonical record instead of typing the number. | `days_active` | [111] | Regenerate through the writer, which emits {{stat:…}} tokens by construction. Do not hand-edit the number. |
| critical | `METRIC_LITERAL_DRIFT` — Prose states 10 public figures impersonated but the canonical value is 11 (full_article). Interpolate from the canonical record instead of typing the number. | `public_figures_impersonated` | [10] | Regenerate through the writer, which emits {{stat:…}} tokens by construction. Do not hand-edit the number. |
| critical | `METRIC_LITERAL_DRIFT` — Prose states 28 creatives observed but the canonical value is 93 (full_article). Interpolate from the canonical record instead of typing the number. | `creatives_observed` | [28] | Regenerate through the writer, which emits {{stat:…}} tokens by construction. Do not hand-edit the number. |
| critical | `DEFINITIVE_CLAIM_UNSUPPORTED` — "Do not deposit" instructs the reader as though the platform were established as unsafe, but this investigation is classified LIMITED_EVIDENCE (17/100), where the page also states that the evidence is not sufficient. State plainly that current evidence is insufficient to classify the entity as a confirmed scam. Do not imply fraud. | `full_article` | CA: None ✕ SEC: None ✕ ASIC: None ✕ CySEC: None ⛔ Final Verdict Fino Inversoría shows limited signals. Ongoing monitoring. Do not deposit any money. Based on an | Soften the wording to the classification’s register, or record the regulator warning / victim reports that would justify it. |
| warning | `PRIMARY_DOMAIN_MISSING` — No primary domain recorded. 10 landing hostname(s) observed, but those are cloaked ad landers and must be confirmed by an analyst before publication — top candidate: breakingless.pro. | `primary_domain` | ["breakingless.pro","rentasolidames.com","elmundoaldiaty.top","elmundodump.top","actualidadenvivoo24.com"] | An analyst must confirm the platform’s own domain. Landing hostnames are cloaked landers and must not be used. |
| warning | `DUPLICATE_TEXT_BLOCK` — The same ~199-character passage appears in 1 places: "it impersonates 10 spanish celebrities without consent, deploys fake profit displays, and traps victim withdrawals throu". | `full_article (×2)` | — | Rewrite one of the duplicated passages; repeated blocks read as thin content. |
| warning | `DUPLICATE_TEXT_BLOCK` — The same ~199-character passage appears in 1 places: "common questions about fino inversoría's operations, regulatory status, recovery options, and warning signs are answered". | `full_article (×2)` | — | Rewrite one of the duplicated passages; repeated blocks read as thin content. |
| warning | `AMBIGUOUS_PARAGRAPH_OPENER` — 1 extractable passage(s) open with an unexplained pronoun, so they lose their subject when lifted on their own. First: "The platform falsely associated itself with at least 10 Spanish public figures, including Pablo Motos, Gloria Serra, Ama". | `full_article` | ["The platform falsely associated itself with at least 10 Spanish public figures, including Pablo Motos, Gloria Serra, Amancio Ortega, Daniel Lacalle, and José  | Rewrite the opening clause to name its subject so the passage survives extraction. |

### `/review/floventra`

Status: published · score 15/100 (live brand 16) · LIMITED_EVIDENCE · publishable today: **NO**

| Severity | Issue | Field | Current value(s) | Recommended action |
|---|---|---|---|---|
| critical | `SCORE_DRIFT` — The investigation asserts 15/100 while the live brand score is 16/100 (delta +1). The page states a threat level our own surveillance data no longer supports. Re-score and regenerate rather than editing one copy. | `threat_score` | {"investigation":15,"live_brand":16,"delta":1} | Decide which score is true, then make BOTH agree in one pass: either re-run the score sync and regenerate the article against the new number, or freeze the brand score. Never edit one copy alone. |
| critical | `METRIC_LITERAL_DRIFT` — Prose states 29 days active but the canonical value is 140 (full_article). Interpolate from the canonical record instead of typing the number. | `days_active` | [29] | Regenerate through the writer, which emits {{stat:…}} tokens by construction. Do not hand-edit the number. |
| critical | `METRIC_SELF_CONTRADICTION` — The page states more than one value for countries targeted: 15 (alternative_headline), 80 (expertise_depth). Both should interpolate the canonical field. | `countries_targeted` | {"15":"alternative_headline","80":"expertise_depth"} | Regenerate the affected fields so both places interpolate the canonical value. |
| critical | `METRIC_LITERAL_DRIFT` — Prose states 80 countries targeted but the canonical value is 15 (expertise_depth). Interpolate from the canonical record instead of typing the number. | `countries_targeted` | [80] | Regenerate through the writer, which emits {{stat:…}} tokens by construction. Do not hand-edit the number. |
| critical | `METRIC_LITERAL_DRIFT` — Prose states 27 public figures impersonated but the canonical value is 31 (full_article). Interpolate from the canonical record instead of typing the number. | `public_figures_impersonated` | [27] | Regenerate through the writer, which emits {{stat:…}} tokens by construction. Do not hand-edit the number. |
| critical | `METRIC_LITERAL_DRIFT` — Prose states 57 creatives observed but the canonical value is 61 (full_article). Interpolate from the canonical record instead of typing the number. | `creatives_observed` | [57] | Regenerate through the writer, which emits {{stat:…}} tokens by construction. Do not hand-edit the number. |
| critical | `DEFINITIVE_CLAIM_UNSUPPORTED` — "Do not deposit" instructs the reader as though the platform were established as unsafe, but this investigation is classified LIMITED_EVIDENCE (15/100), where the page also states that the evidence is not sufficient. State plainly that current evidence is insufficient to classify the entity as a confirmed scam. Do not imply fraud. | `full_article` | ✕ FCA: None ✕ SEC: None ✕ ASIC: None ✕ CySEC: None ⛔ Final Verdict Floventra shows limited signals. Ongoing monitoring. Do not deposit any money. Based on analy | Soften the wording to the classification’s register, or record the regulator warning / victim reports that would justify it. |
| warning | `PRIMARY_DOMAIN_MISSING` — No primary domain recorded. 17 landing hostname(s) observed, but those are cloaked ad landers and must be confirmed by an analyst before publication — top candidate: altemorivansolaretixa.click. | `primary_domain` | ["altemorivansolaretixa.click","hic-error-omnis.top","marvexilndatawx.click","orvalentamersolivarexa.click","plavironlayerx.club"] | An analyst must confirm the platform’s own domain. Landing hostnames are cloaked landers and must not be used. |
| warning | `DUPLICATE_TEXT_BLOCK` — The same ~159-character passage appears in 2 places: "cryptokiller detected {{stat:ad_creatives}} ad creatives impersonating {{stat:celebrities_abused}} public figures across". | `summary + faq[0].answer` | — | Rewrite one of the duplicated passages; repeated blocks read as thin content. |
| warning | `DUPLICATE_TEXT_BLOCK` — The same ~159-character passage appears in 1 places: "cryptokiller detected {{stat:ad_creatives}} ad creatives impersonating {{stat:celebrities_abused}} public figures across". | `full_article (×2)` | — | Rewrite one of the duplicated passages; repeated blocks read as thin content. |

### `/review/gaspipe-ai`

Status: published · score 15/100 (live brand 16) · LIMITED_EVIDENCE · publishable today: **NO**

| Severity | Issue | Field | Current value(s) | Recommended action |
|---|---|---|---|---|
| critical | `SCORE_DRIFT` — The investigation asserts 15/100 while the live brand score is 16/100 (delta +1). The page states a threat level our own surveillance data no longer supports. Re-score and regenerate rather than editing one copy. | `threat_score` | {"investigation":15,"live_brand":16,"delta":1} | Decide which score is true, then make BOTH agree in one pass: either re-run the score sync and regenerate the article against the new number, or freeze the brand score. Never edit one copy alone. |
| critical | `METRIC_LITERAL_DRIFT` — Prose states 297 days active but the canonical value is 335 (full_article). Interpolate from the canonical record instead of typing the number. | `days_active` | [297] | Regenerate through the writer, which emits {{stat:…}} tokens by construction. Do not hand-edit the number. |
| critical | `METRIC_LITERAL_DRIFT` — Prose states 202 creatives observed but the canonical value is 204 (full_article). Interpolate from the canonical record instead of typing the number. | `creatives_observed` | [202] | Regenerate through the writer, which emits {{stat:…}} tokens by construction. Do not hand-edit the number. |
| warning | `METRIC_HARDCODED` — 5 countries targeted matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `countries_targeted` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `METRIC_HARDCODED` — 7 public figures impersonated matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `public_figures_impersonated` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `PRIMARY_DOMAIN_MISSING` — No primary domain recorded. 11 landing hostname(s) observed, but those are cloaked ad landers and must be confirmed by an analyst before publication — top candidate: invest-at-consequatur.top. | `primary_domain` | ["invest-at-consequatur.top","concernanything.com","revisenotices.info","xe.aitradehu.com","fa.aipenzre.com"] | An analyst must confirm the platform’s own domain. Landing hostnames are cloaked landers and must not be used. |

### `/review/halal-trade-ai`

Status: published · score 25/100 (live brand 17) · UNDER_INVESTIGATION · publishable today: **NO**

| Severity | Issue | Field | Current value(s) | Recommended action |
|---|---|---|---|---|
| critical | `SCORE_DRIFT` — The investigation asserts 25/100 while the live brand score is 17/100 (delta -8). The page states a threat level our own surveillance data no longer supports. Re-score and regenerate rather than editing one copy. | `threat_score` | {"investigation":25,"live_brand":17,"delta":-8} | Decide which score is true, then make BOTH agree in one pass: either re-run the score sync and regenerate the article against the new number, or freeze the brand score. Never edit one copy alone. |
| critical | `METRIC_LITERAL_DRIFT` — Prose states 141 days active but the canonical value is 206 (full_article). Interpolate from the canonical record instead of typing the number. | `days_active` | [141] | Regenerate through the writer, which emits {{stat:…}} tokens by construction. Do not hand-edit the number. |
| critical | `METRIC_LITERAL_DRIFT` — Prose states 3 countries targeted but the canonical value is 4 (full_article). Interpolate from the canonical record instead of typing the number. | `countries_targeted` | [3] | Regenerate through the writer, which emits {{stat:…}} tokens by construction. Do not hand-edit the number. |
| critical | `METRIC_LITERAL_DRIFT` — Prose states 30 public figures impersonated but the canonical value is 53 (full_article). Interpolate from the canonical record instead of typing the number. | `public_figures_impersonated` | [30] | Regenerate through the writer, which emits {{stat:…}} tokens by construction. Do not hand-edit the number. |
| critical | `METRIC_LITERAL_DRIFT` — Prose states 138 creatives observed but the canonical value is 355 (full_article). Interpolate from the canonical record instead of typing the number. | `creatives_observed` | [138] | Regenerate through the writer, which emits {{stat:…}} tokens by construction. Do not hand-edit the number. |
| critical | `DEFINITIVE_CLAIM_UNSUPPORTED` — "Do not deposit" instructs the reader as though the platform were established as unsafe, but this investigation is classified UNDER_INVESTIGATION (25/100), where the page also states that the evidence is not sufficient. Observed warning signals may be described. Unverified fraud claims must not be stated as established fact. | `full_article` | Regulatory Status ✕FCA: None ✕SEC: None ✕ASIC: None ✕CySEC: None ⛔Final Verdict Halal Trade AI is under active investigation. Verify before depositing. Do not d | Soften the wording to the classification’s register, or record the regulator warning / victim reports that would justify it. |
| warning | `PRIMARY_DOMAIN_MISSING` — No primary domain recorded. 10 landing hostname(s) observed, but those are cloaked ad landers and must be confirmed by an analyst before publication — top candidate: internationalnewswire.info. | `primary_domain` | ["internationalnewswire.info","globalnewsinsight.info","trivoxnet.info","newsfocusdaily.info","hyperconversionhub.click"] | An analyst must confirm the platform’s own domain. Landing hostnames are cloaked landers and must not be used. |
| warning | `AMBIGUOUS_PARAGRAPH_OPENER` — 1 extractable passage(s) open with an unexplained pronoun, so they lose their subject when lifted on their own. First: "The platform may demand additional payments labeled as Sharia compliance fees or processing charges.". | `full_article` | ["The platform may demand additional payments labeled as Sharia compliance fees or processing charges."] | Rewrite the opening clause to name its subject so the passage survives extraction. |

### `/review/immediate-bienestar`

Status: published · score 30/100 (live brand 21) · UNDER_INVESTIGATION · publishable today: **NO**

| Severity | Issue | Field | Current value(s) | Recommended action |
|---|---|---|---|---|
| critical | `SCORE_DRIFT` — The investigation asserts 30/100 while the live brand score is 21/100 (delta -9). The page states a threat level our own surveillance data no longer supports. Re-score and regenerate rather than editing one copy. | `threat_score` | {"investigation":30,"live_brand":21,"delta":-9} | Decide which score is true, then make BOTH agree in one pass: either re-run the score sync and regenerate the article against the new number, or freeze the brand score. Never edit one copy alone. |
| critical | `METRIC_LITERAL_DRIFT` — Prose states 14 countries targeted but the canonical value is 15 (full_article). Interpolate from the canonical record instead of typing the number. | `countries_targeted` | [14] | Regenerate through the writer, which emits {{stat:…}} tokens by construction. Do not hand-edit the number. |
| critical | `METRIC_LITERAL_DRIFT` — Prose states 55 public figures impersonated but the canonical value is 61 (full_article). Interpolate from the canonical record instead of typing the number. | `public_figures_impersonated` | [55] | Regenerate through the writer, which emits {{stat:…}} tokens by construction. Do not hand-edit the number. |
| critical | `METRIC_LITERAL_DRIFT` — Prose states 173 creatives observed but the canonical value is 191 (full_article). Interpolate from the canonical record instead of typing the number. | `creatives_observed` | [173] | Regenerate through the writer, which emits {{stat:…}} tokens by construction. Do not hand-edit the number. |
| warning | `PRIMARY_DOMAIN_MISSING` — No primary domain recorded. 13 landing hostname(s) observed, but those are cloaked ad landers and must be confirmed by an analyst before publication — top candidate: unfriempcf.com. | `primary_domain` | ["unfriempcf.com","fearfuuafh.com","countratvz.com","williatpzg.com","bankggkw.com"] | An analyst must confirm the platform’s own domain. Landing hostnames are cloaked landers and must not be used. |
| warning | `AMBIGUOUS_PARAGRAPH_OPENER` — 1 extractable passage(s) open with an unexplained pronoun, so they lose their subject when lifted on their own. First: "The platform directs victims through cloned landing pages designed to mimic legitimate cryptocurrency exchanges. Once us". | `full_article` | ["The platform directs victims through cloned landing pages designed to mimic legitimate cryptocurrency exchanges. Once users deposit funds, the system displays | Rewrite the opening clause to name its subject so the passage survives extraction. |

### `/review/immediate-connect`

Status: published · score 25/100 (live brand 16) · UNDER_INVESTIGATION · publishable today: **NO**

| Severity | Issue | Field | Current value(s) | Recommended action |
|---|---|---|---|---|
| critical | `SCORE_DRIFT` — The investigation asserts 25/100 while the live brand score is 16/100 (delta -9). The page states a threat level our own surveillance data no longer supports. Re-score and regenerate rather than editing one copy. | `threat_score` | {"investigation":25,"live_brand":16,"delta":-9} | Decide which score is true, then make BOTH agree in one pass: either re-run the score sync and regenerate the article against the new number, or freeze the brand score. Never edit one copy alone. |
| critical | `METRIC_LITERAL_DRIFT` — Prose states 258 days active but the canonical value is 337 (full_article). Interpolate from the canonical record instead of typing the number. | `days_active` | [258] | Regenerate through the writer, which emits {{stat:…}} tokens by construction. Do not hand-edit the number. |
| critical | `METRIC_LITERAL_DRIFT` — Prose states 3 countries targeted but the canonical value is 4 (full_article). Interpolate from the canonical record instead of typing the number. | `countries_targeted` | [3] | Regenerate through the writer, which emits {{stat:…}} tokens by construction. Do not hand-edit the number. |
| critical | `METRIC_LITERAL_DRIFT` — Prose states 12 public figures impersonated but the canonical value is 15 (full_article). Interpolate from the canonical record instead of typing the number. | `public_figures_impersonated` | [12] | Regenerate through the writer, which emits {{stat:…}} tokens by construction. Do not hand-edit the number. |
| critical | `METRIC_LITERAL_DRIFT` — Prose states 83 creatives observed but the canonical value is 116 (full_article). Interpolate from the canonical record instead of typing the number. | `creatives_observed` | [83] | Regenerate through the writer, which emits {{stat:…}} tokens by construction. Do not hand-edit the number. |
| critical | `DEFINITIVE_CLAIM_UNSUPPORTED` — "Do not deposit" instructs the reader as though the platform were established as unsafe, but this investigation is classified UNDER_INVESTIGATION (25/100), where the page also states that the evidence is not sufficient. Observed warning signals may be described. Unverified fraud claims must not be stated as established fact. | `full_article` | gulatory Status ✕FCA: None ✕SEC: None ✕ASIC: None ✕CySEC: None ⛔Final Verdict Immediate Connect is under active investigation. Verify before depositing. Do not  | Soften the wording to the classification’s register, or record the regulator warning / victim reports that would justify it. |
| warning | `PRIMARY_DOMAIN_MISSING` — No primary domain recorded. 17 landing hostname(s) observed, but those are cloaked ad landers and must be confirmed by an analyst before publication — top candidate: chendisplayed.com. | `primary_domain` | ["chendisplayed.com","esxgrokcom.com","etyspacexing.com","blackwrensblood.com","enniestavil.com"] | An analyst must confirm the platform’s own domain. Landing hostnames are cloaked landers and must not be used. |
| warning | `AMBIGUOUS_PARAGRAPH_OPENER` — 2 extractable passage(s) open with an unexplained pronoun, so they lose their subject when lifted on their own. First: "These ads target users in Germany, India, and Italy through Facebook and Instagram placements, redirecting to disposable". | `full_article` | ["These ads target users in Germany, India, and Italy through Facebook and Instagram placements, redirecting to disposable landing pages like melonitg.com and d | Rewrite the opening clause to name its subject so the passage survives extraction. |

### `/review/immediate-v4-intal`

Status: published · score 33/100 (live brand 24) · UNDER_INVESTIGATION · publishable today: **NO**

| Severity | Issue | Field | Current value(s) | Recommended action |
|---|---|---|---|---|
| critical | `SCORE_DRIFT` — The investigation asserts 33/100 while the live brand score is 24/100 (delta -9). The page states a threat level our own surveillance data no longer supports. Re-score and regenerate rather than editing one copy. | `threat_score` | {"investigation":33,"live_brand":24,"delta":-9} | Decide which score is true, then make BOTH agree in one pass: either re-run the score sync and regenerate the article against the new number, or freeze the brand score. Never edit one copy alone. |
| critical | `METRIC_LITERAL_DRIFT` — Prose states 225 days active but the canonical value is 331 (full_article). Interpolate from the canonical record instead of typing the number. | `days_active` | [225] | Regenerate through the writer, which emits {{stat:…}} tokens by construction. Do not hand-edit the number. |
| critical | `METRIC_LITERAL_DRIFT` — Prose states 9 countries targeted but the canonical value is 12 (alternative_headline). Interpolate from the canonical record instead of typing the number. | `countries_targeted` | [9] | Regenerate through the writer, which emits {{stat:…}} tokens by construction. Do not hand-edit the number. |
| critical | `METRIC_LITERAL_DRIFT` — Prose states 45 public figures impersonated but the canonical value is 56 (full_article). Interpolate from the canonical record instead of typing the number. | `public_figures_impersonated` | [45] | Regenerate through the writer, which emits {{stat:…}} tokens by construction. Do not hand-edit the number. |
| critical | `METRIC_LITERAL_DRIFT` — Prose states 152 creatives observed but the canonical value is 177 (full_article). Interpolate from the canonical record instead of typing the number. | `creatives_observed` | [152] | Regenerate through the writer, which emits {{stat:…}} tokens by construction. Do not hand-edit the number. |
| critical | `DEFINITIVE_CLAIM_UNSUPPORTED` — "Do not deposit" instructs the reader as though the platform were established as unsafe, but this investigation is classified UNDER_INVESTIGATION (33/100), where the page also states that the evidence is not sufficient. Observed warning signals may be described. Unverified fraud claims must not be stated as established fact. | `full_article` | : None ✕ ASIC: None ✕ CySEC: None ⛔ Final Verdict Immediate +V4 Intal is under active investigation. Verify before depositing. Do not deposit any money. Based o | Soften the wording to the classification’s register, or record the regulator warning / victim reports that would justify it. |
| warning | `PRIMARY_DOMAIN_MISSING` — No primary domain recorded. 13 landing hostname(s) observed, but those are cloaked ad landers and must be confirmed by an analyst before publication — top candidate: amiablekap.org. | `primary_domain` | ["amiablekap.org","mechanssqo.com","hikepqot.com","medicojwzc.com","publicummk.com"] | An analyst must confirm the platform’s own domain. Landing hostnames are cloaked landers and must not be used. |

### `/review/investbot`

Status: published · score 27/100 (live brand 19) · UNDER_INVESTIGATION · publishable today: **NO**

| Severity | Issue | Field | Current value(s) | Recommended action |
|---|---|---|---|---|
| critical | `SCORE_DRIFT` — The investigation asserts 27/100 while the live brand score is 19/100 (delta -8). The page states a threat level our own surveillance data no longer supports. Re-score and regenerate rather than editing one copy. | `threat_score` | {"investigation":27,"live_brand":19,"delta":-8} | Decide which score is true, then make BOTH agree in one pass: either re-run the score sync and regenerate the article against the new number, or freeze the brand score. Never edit one copy alone. |
| critical | `METRIC_LITERAL_DRIFT` — Prose states 261 days active but the canonical value is 338 (full_article). Interpolate from the canonical record instead of typing the number. | `days_active` | [261] | Regenerate through the writer, which emits {{stat:…}} tokens by construction. Do not hand-edit the number. |
| critical | `METRIC_SELF_CONTRADICTION` — The page states more than one value for creatives observed: 10087 (expertise_depth), 87 (full_article). Both should interpolate the canonical field. | `creatives_observed` | {"87":"full_article","10087":"expertise_depth"} | Regenerate the affected fields so both places interpolate the canonical value. |
| critical | `METRIC_LITERAL_DRIFT` — Prose states 10087, 87 creatives observed but the canonical value is 353 (expertise_depth, full_article). Interpolate from the canonical record instead of typing the number. | `creatives_observed` | [10087,87] | Regenerate through the writer, which emits {{stat:…}} tokens by construction. Do not hand-edit the number. |
| critical | `DEFINITIVE_CLAIM_UNSUPPORTED` — "is a scam" states fraud as settled fact, but this investigation is classified UNDER_INVESTIGATION (27/100). Observed warning signals may be described. Unverified fraud claims must not be stated as established fact. | `full_article` | Red Flag 3 Very low third-party trust scores ScamAdviser rates investigbot.com with a very low trust score, stating there is a strong likelihood the website is  | Soften the wording to the classification’s register, or record the regulator warning / victim reports that would justify it. |
| warning | `METRIC_HARDCODED` — 8 countries targeted matches the canonical value today but is a literal in meta_description and will drift the next time the scraper runs. | `countries_targeted` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `PRIMARY_DOMAIN_MISSING` — No primary domain recorded. 12 landing hostname(s) observed, but those are cloaked ad landers and must be confirmed by an analyst before publication — top candidate: wa-booster.world. | `primary_domain` | ["wa-booster.world","anboosters.info","silverspindleses.space","pomaverilo.space","candlehuntinvst.com"] | An analyst must confirm the platform’s own domain. Landing hostnames are cloaked landers and must not be used. |
| warning | `AMBIGUOUS_PARAGRAPH_OPENER` — 2 extractable passage(s) open with an unexplained pronoun, so they lose their subject when lifted on their own. First: "These ads promise automated trading profits through AI-powered software, exploiting interest in passive income across em". | `full_article` | ["These ads promise automated trading profits through AI-powered software, exploiting interest in passive income across emerging markets.","These figures bear n | Rewrite the opening clause to name its subject so the passage survives extraction. |

### `/review/justo-credovia`

Status: published · score 4/100 (live brand 5) · LIMITED_EVIDENCE · publishable today: **NO**

| Severity | Issue | Field | Current value(s) | Recommended action |
|---|---|---|---|---|
| critical | `SCORE_DRIFT` — The investigation asserts 4/100 while the live brand score is 5/100 (delta +1). The page states a threat level our own surveillance data no longer supports. Re-score and regenerate rather than editing one copy. | `threat_score` | {"investigation":4,"live_brand":5,"delta":1} | Decide which score is true, then make BOTH agree in one pass: either re-run the score sync and regenerate the article against the new number, or freeze the brand score. Never edit one copy alone. |
| critical | `METRIC_LITERAL_DRIFT` — Prose states 58 days active but the canonical value is 97 (full_article). Interpolate from the canonical record instead of typing the number. | `days_active` | [58] | Regenerate through the writer, which emits {{stat:…}} tokens by construction. Do not hand-edit the number. |
| warning | `METRIC_HARDCODED` — 13 public figures impersonated matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `public_figures_impersonated` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `METRIC_HARDCODED` — 42 creatives observed matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `creatives_observed` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `PRIMARY_DOMAIN_MISSING` — No primary domain recorded. 10 landing hostname(s) observed, but those are cloaked ad landers and must be confirmed by an analyst before publication — top candidate: elmundoreportajes24.com. | `primary_domain` | ["elmundoreportajes24.com","zenturbakoli.info","dailycanareportx.com","mdridnoticiasdiarias.com","noticiasinvestiga24.com"] | An analyst must confirm the platform’s own domain. Landing hostnames are cloaked landers and must not be used. |

### `/review/kaspi-ai`

Status: published · score 18/100 (live brand 9) · LIMITED_EVIDENCE · publishable today: **NO**

| Severity | Issue | Field | Current value(s) | Recommended action |
|---|---|---|---|---|
| critical | `SCORE_DRIFT` — The investigation asserts 18/100 while the live brand score is 9/100 (delta -9). The page states a threat level our own surveillance data no longer supports. Re-score and regenerate rather than editing one copy. | `threat_score` | {"investigation":18,"live_brand":9,"delta":-9} | Decide which score is true, then make BOTH agree in one pass: either re-run the score sync and regenerate the article against the new number, or freeze the brand score. Never edit one copy alone. |
| critical | `METRIC_LITERAL_DRIFT` — Prose states 171 days active but the canonical value is 197 (full_article). Interpolate from the canonical record instead of typing the number. | `days_active` | [171] | Regenerate through the writer, which emits {{stat:…}} tokens by construction. Do not hand-edit the number. |
| critical | `METRIC_LITERAL_DRIFT` — Prose states 8 public figures impersonated but the canonical value is 9 (full_article). Interpolate from the canonical record instead of typing the number. | `public_figures_impersonated` | [8] | Regenerate through the writer, which emits {{stat:…}} tokens by construction. Do not hand-edit the number. |
| critical | `METRIC_LITERAL_DRIFT` — Prose states 136 creatives observed but the canonical value is 175 (full_article). Interpolate from the canonical record instead of typing the number. | `creatives_observed` | [136] | Regenerate through the writer, which emits {{stat:…}} tokens by construction. Do not hand-edit the number. |
| critical | `DEFINITIVE_CLAIM_UNSUPPORTED` — "is a fraudulent operation" states fraud as settled fact, but this investigation is classified LIMITED_EVIDENCE (18/100). State plainly that current evidence is insufficient to classify the entity as a confirmed scam. Do not imply fraud. | `full_article` | he named regulators before acting. Kaspi AI shows limited signals. Ongoing monitoring. Frequently Asked Questions Is Kaspi AI legitimate? No. Kaspi AI is a frau | Soften the wording to the classification’s register, or record the regulator warning / victim reports that would justify it. |
| warning | `METRIC_HARDCODED` — 1 countries targeted matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `countries_targeted` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `PRIMARY_DOMAIN_MISSING` — No primary domain recorded. 16 landing hostname(s) observed, but those are cloaked ad landers and must be confirmed by an analyst before publication — top candidate: meetaltivora.store. | `primary_domain` | ["meetaltivora.store","stavio.shop","sworble.store","xaqejag.com","getnordex.shop"] | An analyst must confirm the platform’s own domain. Landing hostnames are cloaked landers and must not be used. |

### `/review/legacy-bitfundex`

Status: published · score 43/100 (live brand 38) · ELEVATED_RISK · publishable today: **NO**

| Severity | Issue | Field | Current value(s) | Recommended action |
|---|---|---|---|---|
| critical | `SCORE_DRIFT` — The investigation asserts 43/100 while the live brand score is 38/100 (delta -5). The page states a threat level our own surveillance data no longer supports. Re-score and regenerate rather than editing one copy. | `threat_score` | {"investigation":43,"live_brand":38,"delta":-5} | Decide which score is true, then make BOTH agree in one pass: either re-run the score sync and regenerate the article against the new number, or freeze the brand score. Never edit one copy alone. |
| warning | `PRIMARY_DOMAIN_MISSING` — No primary domain recorded. 15 landing hostname(s) observed, but those are cloaked ad landers and must be confirmed by an analyst before publication — top candidate: thinkablepigeon.com. | `primary_domain` | ["thinkablepigeon.com","cautiousbravery.info","ninenest.info","azurewater.info","colossalsushi.com"] | An analyst must confirm the platform’s own domain. Landing hostnames are cloaked landers and must not be used. |

### `/review/nezertronixpro`

Status: published · score 24/100 (live brand 26) · UNDER_INVESTIGATION · publishable today: **NO**

| Severity | Issue | Field | Current value(s) | Recommended action |
|---|---|---|---|---|
| critical | `SCORE_DRIFT` — The investigation asserts 24/100 while the live brand score is 26/100 (delta +2). The page states a threat level our own surveillance data no longer supports. Re-score and regenerate rather than editing one copy. | `threat_score` | {"investigation":24,"live_brand":26,"delta":2} | Decide which score is true, then make BOTH agree in one pass: either re-run the score sync and regenerate the article against the new number, or freeze the brand score. Never edit one copy alone. |
| critical | `METRIC_LITERAL_DRIFT` — Prose states 97 days active but the canonical value is 169 (full_article). Interpolate from the canonical record instead of typing the number. | `days_active` | [97] | Regenerate through the writer, which emits {{stat:…}} tokens by construction. Do not hand-edit the number. |
| critical | `METRIC_LITERAL_DRIFT` — Prose states 25 countries targeted but the canonical value is 26 (full_article). Interpolate from the canonical record instead of typing the number. | `countries_targeted` | [25] | Regenerate through the writer, which emits {{stat:…}} tokens by construction. Do not hand-edit the number. |
| critical | `METRIC_LITERAL_DRIFT` — Prose states 53 public figures impersonated but the canonical value is 70 (full_article). Interpolate from the canonical record instead of typing the number. | `public_figures_impersonated` | [53] | Regenerate through the writer, which emits {{stat:…}} tokens by construction. Do not hand-edit the number. |
| critical | `METRIC_LITERAL_DRIFT` — Prose states 83 creatives observed but the canonical value is 100 (full_article). Interpolate from the canonical record instead of typing the number. | `creatives_observed` | [83] | Regenerate through the writer, which emits {{stat:…}} tokens by construction. Do not hand-edit the number. |
| critical | `DEFINITIVE_CLAIM_UNSUPPORTED` — "Do not deposit" instructs the reader as though the platform were established as unsafe, but this investigation is classified UNDER_INVESTIGATION (24/100), where the page also states that the evidence is not sufficient. Observed warning signals may be described. Unverified fraud claims must not be stated as established fact. | `full_article` | Regulatory Status ✕FCA: None ✕SEC: None ✕ASIC: None ✕CySEC: None ⛔Final Verdict NezertronixPro is under active investigation. Verify before depositing. Do not d | Soften the wording to the classification’s register, or record the regulator warning / victim reports that would justify it. |
| warning | `PRIMARY_DOMAIN_MISSING` — No primary domain recorded. 11 landing hostname(s) observed, but those are cloaked ad landers and must be confirmed by an analyst before publication — top candidate: bilaltradingco.com. | `primary_domain` | ["bilaltradingco.com","reloadingexpert.com","beee2beesuniversity.com","the-dice-box.com","afiniti-consultants.com"] | An analyst must confirm the platform’s own domain. Landing hostnames are cloaked landers and must not be used. |
| warning | `AMBIGUOUS_PARAGRAPH_OPENER` — 2 extractable passage(s) open with an unexplained pronoun, so they lose their subject when lifted on their own. First: "These intermediary pages typically collect personal data — name, phone, email — and prompt an initial deposit.". | `full_article` | ["These intermediary pages typically collect personal data — name, phone, email — and prompt an initial deposit.","The platform may go offline without warning." | Rewrite the opening clause to name its subject so the passage survives extraction. |

### `/review/nordiqo`

Status: published · score 30/100 (live brand 21) · UNDER_INVESTIGATION · publishable today: **NO**

| Severity | Issue | Field | Current value(s) | Recommended action |
|---|---|---|---|---|
| critical | `SCORE_DRIFT` — The investigation asserts 30/100 while the live brand score is 21/100 (delta -9). The page states a threat level our own surveillance data no longer supports. Re-score and regenerate rather than editing one copy. | `threat_score` | {"investigation":30,"live_brand":21,"delta":-9} | Decide which score is true, then make BOTH agree in one pass: either re-run the score sync and regenerate the article against the new number, or freeze the brand score. Never edit one copy alone. |
| critical | `METRIC_LITERAL_DRIFT` — Prose states 235 days active but the canonical value is 339 (full_article). Interpolate from the canonical record instead of typing the number. | `days_active` | [235] | Regenerate through the writer, which emits {{stat:…}} tokens by construction. Do not hand-edit the number. |
| critical | `METRIC_LITERAL_DRIFT` — Prose states 10 public figures impersonated but the canonical value is 11 (meta_description). Interpolate from the canonical record instead of typing the number. | `public_figures_impersonated` | [10] | Regenerate through the writer, which emits {{stat:…}} tokens by construction. Do not hand-edit the number. |
| critical | `METRIC_LITERAL_DRIFT` — Prose states 240 creatives observed but the canonical value is 307 (alternative_headline). Interpolate from the canonical record instead of typing the number. | `creatives_observed` | [240] | Regenerate through the writer, which emits {{stat:…}} tokens by construction. Do not hand-edit the number. |
| critical | `DEFINITIVE_CLAIM_UNSUPPORTED` — "Do not deposit" instructs the reader as though the platform were established as unsafe, but this investigation is classified UNDER_INVESTIGATION (30/100), where the page also states that the evidence is not sufficient. Observed warning signals may be described. Unverified fraud claims must not be stated as established fact. | `full_article` | ne ✕ SEC: None ✕ ASIC: None ✕ CySEC: None ⛔ Final Verdict Nordiqo is under active investigation. Verify before depositing. Do not deposit any money. Based on an | Soften the wording to the classification’s register, or record the regulator warning / victim reports that would justify it. |
| warning | `METRIC_HARDCODED` — 11 countries targeted matches the canonical value today but is a literal in meta_description and will drift the next time the scraper runs. | `countries_targeted` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `PRIMARY_DOMAIN_MISSING` — No primary domain recorded. 7 landing hostname(s) observed, but those are cloaked ad landers and must be confirmed by an analyst before publication — top candidate: articfinnews.com. | `primary_domain` | ["articfinnews.com","alnewsca.com","canadatodaywire.com","insdertack.world","makenowktack.world"] | An analyst must confirm the platform’s own domain. Landing hostnames are cloaked landers and must not be used. |

### `/review/peak-luxentria`

Status: published · score 11/100 (live brand 1) · LIMITED_EVIDENCE · publishable today: **NO**

| Severity | Issue | Field | Current value(s) | Recommended action |
|---|---|---|---|---|
| critical | `SCORE_DRIFT` — The investigation asserts 11/100 while the live brand score is 1/100 (delta -10). The page states a threat level our own surveillance data no longer supports. Re-score and regenerate rather than editing one copy. | `threat_score` | {"investigation":11,"live_brand":1,"delta":-10} | Decide which score is true, then make BOTH agree in one pass: either re-run the score sync and regenerate the article against the new number, or freeze the brand score. Never edit one copy alone. |
| warning | `PRIMARY_DOMAIN_MISSING` — No primary domain recorded. 2 landing hostname(s) observed, but those are cloaked ad landers and must be confirmed by an analyst before publication — top candidate: sharpminddump.info. | `primary_domain` | ["sharpminddump.info","cleverlogicty.pro"] | An analyst must confirm the platform’s own domain. Landing hostnames are cloaked landers and must not be used. |

### `/review/prestara-nexor`

Status: published · score 8/100 (live brand 8) · LIMITED_EVIDENCE · publishable today: **NO**

| Severity | Issue | Field | Current value(s) | Recommended action |
|---|---|---|---|---|
| critical | `METRIC_LITERAL_DRIFT` — Prose states 17 days active but the canonical value is 122 (full_article). Interpolate from the canonical record instead of typing the number. | `days_active` | [17] | Regenerate through the writer, which emits {{stat:…}} tokens by construction. Do not hand-edit the number. |
| critical | `METRIC_LITERAL_DRIFT` — Prose states 19 public figures impersonated but the canonical value is 26 (full_article). Interpolate from the canonical record instead of typing the number. | `public_figures_impersonated` | [19] | Regenerate through the writer, which emits {{stat:…}} tokens by construction. Do not hand-edit the number. |
| critical | `METRIC_LITERAL_DRIFT` — Prose states 61 creatives observed but the canonical value is 111 (meta_description). Interpolate from the canonical record instead of typing the number. | `creatives_observed` | [61] | Regenerate through the writer, which emits {{stat:…}} tokens by construction. Do not hand-edit the number. |
| critical | `DEFINITIVE_CLAIM_UNSUPPORTED` — "Do not deposit" instructs the reader as though the platform were established as unsafe, but this investigation is classified LIMITED_EVIDENCE (8/100), where the page also states that the evidence is not sufficient. State plainly that current evidence is insufficient to classify the entity as a confirmed scam. Do not imply fraud. | `full_article` | FCA: None ✕ SEC: None ✕ ASIC: None ✕ CySEC: None ⛔ Final Verdict Prestara Nexor shows limited signals. Ongoing monitoring. Do not deposit any money. Based on an | Soften the wording to the classification’s register, or record the regulator warning / victim reports that would justify it. |
| warning | `PRIMARY_DOMAIN_MISSING` — No primary domain recorded. 11 landing hostname(s) observed, but those are cloaked ad landers and must be confirmed by an analyst before publication — top candidate: optimized-commerce-engine.cloud. | `primary_domain` | ["optimized-commerce-engine.cloud","innovation-commerce-hub.art","sales-acceleration-system.cloud","digital-growth-framework.pro","dynamic-marketing-system.digi | An analyst must confirm the platform’s own domain. Landing hostnames are cloaked landers and must not be used. |

### `/review/prestaranexor`

Status: published · score 3/100 (live brand 4) · LIMITED_EVIDENCE · publishable today: **NO**

| Severity | Issue | Field | Current value(s) | Recommended action |
|---|---|---|---|---|
| critical | `SCORE_DRIFT` — The investigation asserts 3/100 while the live brand score is 4/100 (delta +1). The page states a threat level our own surveillance data no longer supports. Re-score and regenerate rather than editing one copy. | `threat_score` | {"investigation":3,"live_brand":4,"delta":1} | Decide which score is true, then make BOTH agree in one pass: either re-run the score sync and regenerate the article against the new number, or freeze the brand score. Never edit one copy alone. |
| critical | `METRIC_LITERAL_DRIFT` — Prose states 17 days active but the canonical value is 70 (full_article). Interpolate from the canonical record instead of typing the number. | `days_active` | [17] | Regenerate through the writer, which emits {{stat:…}} tokens by construction. Do not hand-edit the number. |
| critical | `DEFINITIVE_CLAIM_UNSUPPORTED` — "Do not deposit" instructs the reader as though the platform were established as unsafe, but this investigation is classified LIMITED_EVIDENCE (3/100), where the page also states that the evidence is not sufficient. State plainly that current evidence is insufficient to classify the entity as a confirmed scam. Do not imply fraud. | `full_article` | FCA: None ✕ SEC: None ✕ ASIC: None ✕ CySEC: None ⛔ Final Verdict PrestaraNexor shows limited signals. Ongoing monitoring. Do not deposit any money. Based on ana | Soften the wording to the classification’s register, or record the regulator warning / victim reports that would justify it. |
| warning | `METRIC_HARDCODED` — 2 countries targeted matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `countries_targeted` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `METRIC_HARDCODED` — 4 public figures impersonated matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `public_figures_impersonated` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `METRIC_HARDCODED` — 37 creatives observed matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `creatives_observed` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `PRIMARY_DOMAIN_MISSING` — No primary domain recorded. 7 landing hostname(s) observed, but those are cloaked ad landers and must be confirmed by an analyst before publication — top candidate: invertprogram.com. | `primary_domain` | ["invertprogram.com","programinversiones.com","revenurise.com","investteamworld.com","likemagenta.com"] | An analyst must confirm the platform’s own domain. Landing hostnames are cloaked landers and must not be used. |

### `/review/primeaura`

Status: published · score 55/100 (live brand 46) · ELEVATED_RISK · publishable today: **NO**

| Severity | Issue | Field | Current value(s) | Recommended action |
|---|---|---|---|---|
| critical | `SCORE_DRIFT` — The investigation asserts 55/100 while the live brand score is 46/100 (delta -9). The page states a threat level our own surveillance data no longer supports. Re-score and regenerate rather than editing one copy. | `threat_score` | {"investigation":55,"live_brand":46,"delta":-9} | Decide which score is true, then make BOTH agree in one pass: either re-run the score sync and regenerate the article against the new number, or freeze the brand score. Never edit one copy alone. |
| critical | `METRIC_LITERAL_DRIFT` — Prose states 56 public figures impersonated but the canonical value is 166 (full_article). Interpolate from the canonical record instead of typing the number. | `public_figures_impersonated` | [56] | Regenerate through the writer, which emits {{stat:…}} tokens by construction. Do not hand-edit the number. |
| critical | `METRIC_LITERAL_DRIFT` — Prose states 388 creatives observed but the canonical value is 474 (full_article). Interpolate from the canonical record instead of typing the number. | `creatives_observed` | [388] | Regenerate through the writer, which emits {{stat:…}} tokens by construction. Do not hand-edit the number. |
| warning | `METRIC_HARDCODED` — 34 countries targeted matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `countries_targeted` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `PRIMARY_DOMAIN_MISSING` — No primary domain recorded. 22 landing hostname(s) observed, but those are cloaked ad landers and must be confirmed by an analyst before publication — top candidate: cashinkaro.com. | `primary_domain` | ["cashinkaro.com","farbfotos.com","timesofmalta.site","affordablecleaningservicerichmond.com","brookesbodybutta.com"] | An analyst must confirm the platform’s own domain. Landing hostnames are cloaked landers and must not be used. |

### `/review/quantum`

Status: draft · score 38/100 (live brand 29) · UNDER_INVESTIGATION · publishable today: **NO**

| Severity | Issue | Field | Current value(s) | Recommended action |
|---|---|---|---|---|
| critical | `SCORE_DRIFT` — The investigation asserts 38/100 while the live brand score is 29/100 (delta -9). The page states a threat level our own surveillance data no longer supports. Re-score and regenerate rather than editing one copy. | `threat_score` | {"investigation":38,"live_brand":29,"delta":-9} | Decide which score is true, then make BOTH agree in one pass: either re-run the score sync and regenerate the article against the new number, or freeze the brand score. Never edit one copy alone. |
| critical | `METRIC_LITERAL_DRIFT` — Prose states 406 creatives observed but the canonical value is 417 (full_article). Interpolate from the canonical record instead of typing the number. | `creatives_observed` | [406] | Regenerate through the writer, which emits {{stat:…}} tokens by construction. Do not hand-edit the number. |
| warning | `METRIC_HARDCODED` — 20 countries targeted matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `countries_targeted` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `METRIC_HARDCODED` — 48 public figures impersonated matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `public_figures_impersonated` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `PRIMARY_DOMAIN_MISSING` — No primary domain recorded. 16 landing hostname(s) observed, but those are cloaked ad landers and must be confirmed by an analyst before publication — top candidate: frquantummai.com. | `primary_domain` | ["frquantummai.com","newscando-lom.com","signalinfovive.com","sourcemediaactuelle.com","castlevistahouse.com"] | An analyst must confirm the platform’s own domain. Landing hostnames are cloaked landers and must not be used. |

### `/review/quantum-ai`

Status: published · score 95/100 (live brand 86) · HIGH_RISK · publishable today: **NO**

| Severity | Issue | Field | Current value(s) | Recommended action |
|---|---|---|---|---|
| critical | `SCORE_DRIFT` — The investigation asserts 95/100 while the live brand score is 86/100 (delta -9). The page states a threat level our own surveillance data no longer supports. Re-score and regenerate rather than editing one copy. | `threat_score` | {"investigation":95,"live_brand":86,"delta":-9} | Decide which score is true, then make BOTH agree in one pass: either re-run the score sync and regenerate the article against the new number, or freeze the brand score. Never edit one copy alone. |
| critical | `DEFINITIVE_CLAIM_UNSUPPORTED` — "Confirmed Crypto Scam" states fraud as settled fact, but this investigation is classified HIGH_RISK (95/100) and lacks a regulator-issued warning naming this entity / enforcement actions in more than one jurisdiction / documented consumer harm (victim reports on file). Strong warning language is permitted where the evidence on file supports the specific claim. Do not assert "confirmed scam" as settled fact. | `alternative_headline` | Quantum AI Is a Confirmed Crypto Scam — Here's the Evidence | Soften the wording to the classification’s register, or record the regulator warning / victim reports that would justify it. |
| warning | `CONFIRMED_EVIDENCE_SHORTFALL` — Score 95 sits in the CONFIRMED band but the methodology's evidentiary test is unmet (needs a regulator-issued warning naming this entity or enforcement actions in more than one jurisdiction or documented consumer harm (victim reports on file)). Presented as HIGH_RISK until one is recorded. | `threat_classification` | — | Record a regulator warning, a second-jurisdiction enforcement action, or victim reports — or accept the one-band downgrade. |
| warning | `PRIMARY_DOMAIN_MISSING` — No primary domain recorded. 24 landing hostname(s) observed, but those are cloaked ad landers and must be confirmed by an analyst before publication — top candidate: alphanet.space. | `primary_domain` | ["alphanet.space","boostprism.com","branrdello.com","lps.brenyxis.com","newzealandtimes-nz.com"] | An analyst must confirm the platform’s own domain. Landing hostnames are cloaked landers and must not be used. |

### `/review/quarix-ai`

Status: published · score 7/100 (live brand 8) · LIMITED_EVIDENCE · publishable today: **NO**

| Severity | Issue | Field | Current value(s) | Recommended action |
|---|---|---|---|---|
| critical | `SCORE_DRIFT` — The investigation asserts 7/100 while the live brand score is 8/100 (delta +1). The page states a threat level our own surveillance data no longer supports. Re-score and regenerate rather than editing one copy. | `threat_score` | {"investigation":7,"live_brand":8,"delta":1} | Decide which score is true, then make BOTH agree in one pass: either re-run the score sync and regenerate the article against the new number, or freeze the brand score. Never edit one copy alone. |
| critical | `DEFINITIVE_CLAIM_UNSUPPORTED` — "Do not deposit" instructs the reader as though the platform were established as unsafe, but this investigation is classified LIMITED_EVIDENCE (7/100), where the page also states that the evidence is not sufficient. State plainly that current evidence is insufficient to classify the entity as a confirmed scam. Do not imply fraud. | `full_article` | ✕ FCA: None ✕ SEC: None ✕ ASIC: None ✕ CySEC: None ⛔ Final Verdict Quarix AI shows limited signals. Ongoing monitoring. Do not deposit any money. Based on analy | Soften the wording to the classification’s register, or record the regulator warning / victim reports that would justify it. |
| warning | `METRIC_HARDCODED` — 12 public figures impersonated matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `public_figures_impersonated` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `METRIC_HARDCODED` — 138 creatives observed matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `creatives_observed` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `PRIMARY_DOMAIN_MISSING` — No primary domain recorded. 10 landing hostname(s) observed, but those are cloaked ad landers and must be confirmed by an analyst before publication — top candidate: profit-marketing-platform.top. | `primary_domain` | ["profit-marketing-platform.top","advance-commerce-system.top","efficient-marketing-engine.art","peak-marketing-platform.top","convert-ecommerce-system.pro"] | An analyst must confirm the platform’s own domain. Landing hostnames are cloaked landers and must not be used. |

### `/review/senvix`

Status: published · score 56/100 (live brand 47) · ELEVATED_RISK · publishable today: **NO**

| Severity | Issue | Field | Current value(s) | Recommended action |
|---|---|---|---|---|
| critical | `SCORE_DRIFT` — The investigation asserts 56/100 while the live brand score is 47/100 (delta -9). The page states a threat level our own surveillance data no longer supports. Re-score and regenerate rather than editing one copy. | `threat_score` | {"investigation":56,"live_brand":47,"delta":-9} | Decide which score is true, then make BOTH agree in one pass: either re-run the score sync and regenerate the article against the new number, or freeze the brand score. Never edit one copy alone. |
| critical | `METRIC_LITERAL_DRIFT` — Prose states 232 days active but the canonical value is 338 (full_article). Interpolate from the canonical record instead of typing the number. | `days_active` | [232] | Regenerate through the writer, which emits {{stat:…}} tokens by construction. Do not hand-edit the number. |
| critical | `METRIC_LITERAL_DRIFT` — Prose states 17 countries targeted but the canonical value is 18 (alternative_headline). Interpolate from the canonical record instead of typing the number. | `countries_targeted` | [17] | Regenerate through the writer, which emits {{stat:…}} tokens by construction. Do not hand-edit the number. |
| critical | `METRIC_LITERAL_DRIFT` — Prose states 37 public figures impersonated but the canonical value is 107 (alternative_headline). Interpolate from the canonical record instead of typing the number. | `public_figures_impersonated` | [37] | Regenerate through the writer, which emits {{stat:…}} tokens by construction. Do not hand-edit the number. |
| critical | `METRIC_LITERAL_DRIFT` — Prose states 1107 creatives observed but the canonical value is 1278 (full_article). Interpolate from the canonical record instead of typing the number. | `creatives_observed` | [1107] | Regenerate through the writer, which emits {{stat:…}} tokens by construction. Do not hand-edit the number. |
| warning | `PRIMARY_DOMAIN_MISSING` — No primary domain recorded. 25 landing hostname(s) observed, but those are cloaked ad landers and must be confirmed by an analyst before publication — top candidate: internet-sicurezza.novita-informazioni.com. | `primary_domain` | ["internet-sicurezza.novita-informazioni.com","monexa.pri-tooth.com","omelix.pri-tooth.com","vyntro.pri-tooth.com","bitcomyl.vip"] | An analyst must confirm the platform’s own domain. Landing hostnames are cloaked landers and must not be used. |

### `/review/thistle-gainmere`

Status: published · score 11/100 (live brand 1) · LIMITED_EVIDENCE · publishable today: **NO**

| Severity | Issue | Field | Current value(s) | Recommended action |
|---|---|---|---|---|
| critical | `SCORE_DRIFT` — The investigation asserts 11/100 while the live brand score is 1/100 (delta -10). The page states a threat level our own surveillance data no longer supports. Re-score and regenerate rather than editing one copy. | `threat_score` | {"investigation":11,"live_brand":1,"delta":-10} | Decide which score is true, then make BOTH agree in one pass: either re-run the score sync and regenerate the article against the new number, or freeze the brand score. Never edit one copy alone. |
| warning | `PRIMARY_DOMAIN_MISSING` — No primary domain recorded. 2 landing hostname(s) observed, but those are cloaked ad landers and must be confirmed by an analyst before publication — top candidate: candeloraqi.info. | `primary_domain` | ["candeloraqi.info","fieroenogauca.xyz"] | An analyst must confirm the platform’s own domain. Landing hostnames are cloaked landers and must not be used. |

### `/review/trade-vector-ai`

Status: published · score 48/100 (live brand 42) · ELEVATED_RISK · publishable today: **NO**

| Severity | Issue | Field | Current value(s) | Recommended action |
|---|---|---|---|---|
| critical | `SCORE_DRIFT` — The investigation asserts 48/100 while the live brand score is 42/100 (delta -6). The page states a threat level our own surveillance data no longer supports. Re-score and regenerate rather than editing one copy. | `threat_score` | {"investigation":48,"live_brand":42,"delta":-6} | Decide which score is true, then make BOTH agree in one pass: either re-run the score sync and regenerate the article against the new number, or freeze the brand score. Never edit one copy alone. |
| critical | `METRIC_LITERAL_DRIFT` — Prose states 233 days active but the canonical value is 338 (full_article). Interpolate from the canonical record instead of typing the number. | `days_active` | [233] | Regenerate through the writer, which emits {{stat:…}} tokens by construction. Do not hand-edit the number. |
| critical | `METRIC_LITERAL_DRIFT` — Prose states 20 countries targeted but the canonical value is 24 (full_article). Interpolate from the canonical record instead of typing the number. | `countries_targeted` | [20] | Regenerate through the writer, which emits {{stat:…}} tokens by construction. Do not hand-edit the number. |
| critical | `METRIC_LITERAL_DRIFT` — Prose states 65 public figures impersonated but the canonical value is 136 (full_article). Interpolate from the canonical record instead of typing the number. | `public_figures_impersonated` | [65] | Regenerate through the writer, which emits {{stat:…}} tokens by construction. Do not hand-edit the number. |
| critical | `METRIC_LITERAL_DRIFT` — Prose states 453 creatives observed but the canonical value is 596 (full_article). Interpolate from the canonical record instead of typing the number. | `creatives_observed` | [453] | Regenerate through the writer, which emits {{stat:…}} tokens by construction. Do not hand-edit the number. |
| critical | `STRONG_CLAIM_UNSOURCED` — The article makes 1 allegation(s) requiring external support (regulator_action) but carries no sources or citations. First: "FCA warning". | `sources` | ["FCA warning"] | Attach the source for each allegation, or remove the allegation. |
| warning | `PRIMARY_DOMAIN_MISSING` — No primary domain recorded. 12 landing hostname(s) observed, but those are cloaked ad landers and must be confirmed by an analyst before publication — top candidate: citynewsflash.news. | `primary_domain` | ["citynewsflash.news","globalpress.click","globalfocuslive.com","smartmoneynews.club","cityreport.news"] | An analyst must confirm the platform’s own domain. Landing hostnames are cloaked landers and must not be used. |

### `/review/tradegpt`

Status: published · score 30/100 (live brand 21) · UNDER_INVESTIGATION · publishable today: **NO**

| Severity | Issue | Field | Current value(s) | Recommended action |
|---|---|---|---|---|
| critical | `SCORE_DRIFT` — The investigation asserts 30/100 while the live brand score is 21/100 (delta -9). The page states a threat level our own surveillance data no longer supports. Re-score and regenerate rather than editing one copy. | `threat_score` | {"investigation":30,"live_brand":21,"delta":-9} | Decide which score is true, then make BOTH agree in one pass: either re-run the score sync and regenerate the article against the new number, or freeze the brand score. Never edit one copy alone. |
| critical | `METRIC_LITERAL_DRIFT` — Prose states 310 days active but the canonical value is 338 (full_article). Interpolate from the canonical record instead of typing the number. | `days_active` | [310] | Regenerate through the writer, which emits {{stat:…}} tokens by construction. Do not hand-edit the number. |
| critical | `METRIC_LITERAL_DRIFT` — Prose states 15 countries targeted but the canonical value is 17 (full_article). Interpolate from the canonical record instead of typing the number. | `countries_targeted` | [15] | Regenerate through the writer, which emits {{stat:…}} tokens by construction. Do not hand-edit the number. |
| critical | `METRIC_LITERAL_DRIFT` — Prose states 13 public figures impersonated but the canonical value is 14 (full_article). Interpolate from the canonical record instead of typing the number. | `public_figures_impersonated` | [13] | Regenerate through the writer, which emits {{stat:…}} tokens by construction. Do not hand-edit the number. |
| critical | `METRIC_LITERAL_DRIFT` — Prose states 77 creatives observed but the canonical value is 90 (full_article). Interpolate from the canonical record instead of typing the number. | `creatives_observed` | [77] | Regenerate through the writer, which emits {{stat:…}} tokens by construction. Do not hand-edit the number. |
| critical | `DEFINITIVE_CLAIM_UNSUPPORTED` — "confirmed investment scam" states fraud as settled fact, but this investigation is classified UNDER_INVESTIGATION (30/100). Observed warning signals may be described. Unverified fraud claims must not be stated as established fact. | `full_article` | ing {{stat:celebrities_abused}} public figures — patterns that warrant caution and further verification before any deposit. ⚠️ Key Takeaways TradeGPT is a confi | Soften the wording to the classification’s register, or record the regulator warning / victim reports that would justify it. |
| warning | `PRIMARY_DOMAIN_MISSING` — No primary domain recorded. 5 landing hostname(s) observed, but those are cloaked ad landers and must be confirmed by an analyst before publication — top candidate: dromexo.com. | `primary_domain` | ["dromexo.com","brimonto.com","meta-bananago.com","trk.sandoxaro.com","zylopare.com"] | An analyst must confirm the platform’s own domain. Landing hostnames are cloaked landers and must not be used. |
| warning | `DUPLICATE_TEXT_BLOCK` — The same ~253-character passage appears in 1 places: "investigation data shows 77 fraudulent advertisements targeting cryptocurrency traders through celebrity impersonation, ". | `full_article (×2)` | — | Rewrite one of the duplicated passages; repeated blocks read as thin content. |

### `/review/visi-n-luxovel`

Status: published · score 4/100 (live brand 5) · LIMITED_EVIDENCE · publishable today: **NO**

| Severity | Issue | Field | Current value(s) | Recommended action |
|---|---|---|---|---|
| critical | `SCORE_DRIFT` — The investigation asserts 4/100 while the live brand score is 5/100 (delta +1). The page states a threat level our own surveillance data no longer supports. Re-score and regenerate rather than editing one copy. | `threat_score` | {"investigation":4,"live_brand":5,"delta":1} | Decide which score is true, then make BOTH agree in one pass: either re-run the score sync and regenerate the article against the new number, or freeze the brand score. Never edit one copy alone. |
| critical | `METRIC_LITERAL_DRIFT` — Prose states 5 days active but the canonical value is 92 (full_article). Interpolate from the canonical record instead of typing the number. | `days_active` | [5] | Regenerate through the writer, which emits {{stat:…}} tokens by construction. Do not hand-edit the number. |
| critical | `METRIC_LITERAL_DRIFT` — Prose states 9 public figures impersonated but the canonical value is 11 (meta_description). Interpolate from the canonical record instead of typing the number. | `public_figures_impersonated` | [9] | Regenerate through the writer, which emits {{stat:…}} tokens by construction. Do not hand-edit the number. |
| critical | `METRIC_LITERAL_DRIFT` — Prose states 27 creatives observed but the canonical value is 36 (meta_description). Interpolate from the canonical record instead of typing the number. | `creatives_observed` | [27] | Regenerate through the writer, which emits {{stat:…}} tokens by construction. Do not hand-edit the number. |
| critical | `DEFINITIVE_CLAIM_UNSUPPORTED` — "Do not deposit" instructs the reader as though the platform were established as unsafe, but this investigation is classified LIMITED_EVIDENCE (4/100), where the page also states that the evidence is not sufficient. State plainly that current evidence is insufficient to classify the entity as a confirmed scam. Do not imply fraud. | `full_article` | ing EuropeES Regulatory Status ✕FCA: None ✕SEC: None ✕ASIC: None ✕CySEC: None ⛔Final Verdict Visión Luxovel shows limited signals. Ongoing monitoring. Do not de | Soften the wording to the classification’s register, or record the regulator warning / victim reports that would justify it. |
| warning | `PRIMARY_DOMAIN_MISSING` — No primary domain recorded. 13 landing hostname(s) observed, but those are cloaked ad landers and must be confirmed by an analyst before publication — top candidate: elinformadordiario24.com. | `primary_domain` | ["elinformadordiario24.com","polvarina24.pro","solvarineta.pro","alynodermisu.info","drapoxinelku.info"] | An analyst must confirm the platform’s own domain. Landing hostnames are cloaked landers and must not be used. |
| warning | `AMBIGUOUS_PARAGRAPH_OPENER` — 3 extractable passage(s) open with an unexplained pronoun, so they lose their subject when lifted on their own. First: "These ads target Spain exclusively through Facebook placements.". | `full_article` | ["These ads target Spain exclusively through Facebook placements.","These landing URLs contain extensive tracking parameters (campaign_id, adset_id, ad_id) typi | Rewrite the opening clause to name its subject so the passage survives extraction. |

### `/review/vlna-kapitisk`

Status: published · score 2/100 (live brand 2) · LIMITED_EVIDENCE · publishable today: **NO**

| Severity | Issue | Field | Current value(s) | Recommended action |
|---|---|---|---|---|
| critical | `METRIC_LITERAL_DRIFT` — Prose states 3 days active but the canonical value is 41 (full_article). Interpolate from the canonical record instead of typing the number. | `days_active` | [3] | Regenerate through the writer, which emits {{stat:…}} tokens by construction. Do not hand-edit the number. |
| warning | `METRIC_HARDCODED` — 6 public figures impersonated matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `public_figures_impersonated` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `METRIC_HARDCODED` — 19 creatives observed matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `creatives_observed` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `PRIMARY_DOMAIN_MISSING` — No primary domain recorded. 5 landing hostname(s) observed, but those are cloaked ad landers and must be confirmed by an analyst before publication — top candidate: uentarqivox.pro. | `primary_domain` | ["uentarqivox.pro","nexusmediad.top","quantumnewsd.pro","seznpravien.com","crystalclearalerts.info"] | An analyst must confirm the platform’s own domain. Landing hostnames are cloaked landers and must not be used. |

### `/review/whatsapp-ai`

Status: published · score 35/100 (live brand 28) · UNDER_INVESTIGATION · publishable today: **NO**

| Severity | Issue | Field | Current value(s) | Recommended action |
|---|---|---|---|---|
| critical | `SCORE_DRIFT` — The investigation asserts 35/100 while the live brand score is 28/100 (delta -7). The page states a threat level our own surveillance data no longer supports. Re-score and regenerate rather than editing one copy. | `threat_score` | {"investigation":35,"live_brand":28,"delta":-7} | Decide which score is true, then make BOTH agree in one pass: either re-run the score sync and regenerate the article against the new number, or freeze the brand score. Never edit one copy alone. |
| critical | `METRIC_LITERAL_DRIFT` — Prose states 242 days active but the canonical value is 332 (full_article). Interpolate from the canonical record instead of typing the number. | `days_active` | [242] | Regenerate through the writer, which emits {{stat:…}} tokens by construction. Do not hand-edit the number. |
| critical | `METRIC_LITERAL_DRIFT` — Prose states 13 countries targeted but the canonical value is 20 (full_article). Interpolate from the canonical record instead of typing the number. | `countries_targeted` | [13] | Regenerate through the writer, which emits {{stat:…}} tokens by construction. Do not hand-edit the number. |
| critical | `METRIC_LITERAL_DRIFT` — Prose states 16 public figures impersonated but the canonical value is 22 (full_article). Interpolate from the canonical record instead of typing the number. | `public_figures_impersonated` | [16] | Regenerate through the writer, which emits {{stat:…}} tokens by construction. Do not hand-edit the number. |
| critical | `METRIC_LITERAL_DRIFT` — Prose states 387 creatives observed but the canonical value is 503 (full_article). Interpolate from the canonical record instead of typing the number. | `creatives_observed` | [387] | Regenerate through the writer, which emits {{stat:…}} tokens by construction. Do not hand-edit the number. |
| critical | `DEFINITIVE_CLAIM_UNSUPPORTED` — "Do not deposit" instructs the reader as though the platform were established as unsafe, but this investigation is classified UNDER_INVESTIGATION (35/100), where the page also states that the evidence is not sufficient. Observed warning signals may be described. Unverified fraud claims must not be stated as established fact. | `full_article` | PT Regulatory Status ✕FCA: None ✕SEC: None ✕ASIC: None ✕CySEC: None ⛔Final Verdict WhatsApp AI is under active investigation. Verify before depositing. Do not d | Soften the wording to the classification’s register, or record the regulator warning / victim reports that would justify it. |
| warning | `PRIMARY_DOMAIN_MISSING` — No primary domain recorded. 11 landing hostname(s) observed, but those are cloaked ad landers and must be confirmed by an analyst before publication — top candidate: aiwabot.site. | `primary_domain` | ["aiwabot.site","yptelea.hair","botwa.xyz","der-gasaretes.site","eu.gptpbot.com"] | An analyst must confirm the platform’s own domain. Landing hostnames are cloaked landers and must not be used. |
| warning | `AMBIGUOUS_PARAGRAPH_OPENER` — 2 extractable passage(s) open with an unexplained pronoun, so they lose their subject when lifted on their own. First: "These ads run across {{stat:countries_targeted}} countries, geo-targeted to Armenia, Bulgaria, Moldova, the Baltics, and". | `full_article` | ["These ads run across {{stat:countries_targeted}} countries, geo-targeted to Armenia, Bulgaria, Moldova, the Baltics, and others.","These pages typically colle | Rewrite the opening clause to name its subject so the passage survives extraction. |

### `/review/whatsapp-bot`

Status: published · score 30/100 (live brand 21) · UNDER_INVESTIGATION · publishable today: **NO**

| Severity | Issue | Field | Current value(s) | Recommended action |
|---|---|---|---|---|
| critical | `SCORE_DRIFT` — The investigation asserts 30/100 while the live brand score is 21/100 (delta -9). The page states a threat level our own surveillance data no longer supports. Re-score and regenerate rather than editing one copy. | `threat_score` | {"investigation":30,"live_brand":21,"delta":-9} | Decide which score is true, then make BOTH agree in one pass: either re-run the score sync and regenerate the article against the new number, or freeze the brand score. Never edit one copy alone. |
| critical | `METRIC_LITERAL_DRIFT` — Prose states 234 days active but the canonical value is 338 (full_article). Interpolate from the canonical record instead of typing the number. | `days_active` | [234] | Regenerate through the writer, which emits {{stat:…}} tokens by construction. Do not hand-edit the number. |
| critical | `METRIC_LITERAL_DRIFT` — Prose states 11 countries targeted but the canonical value is 13 (alternative_headline). Interpolate from the canonical record instead of typing the number. | `countries_targeted` | [11] | Regenerate through the writer, which emits {{stat:…}} tokens by construction. Do not hand-edit the number. |
| critical | `METRIC_LITERAL_DRIFT` — Prose states 236 creatives observed but the canonical value is 254 (full_article). Interpolate from the canonical record instead of typing the number. | `creatives_observed` | [236] | Regenerate through the writer, which emits {{stat:…}} tokens by construction. Do not hand-edit the number. |
| critical | `DEFINITIVE_CLAIM_UNSUPPORTED` — "Do not deposit" instructs the reader as though the platform were established as unsafe, but this investigation is classified UNDER_INVESTIGATION (30/100), where the page also states that the evidence is not sufficient. Observed warning signals may be described. Unverified fraud claims must not be stated as established fact. | `full_article` | ✕ SEC: None ✕ ASIC: None ✕ CySEC: None ⛔ Final Verdict WhatsApp Bot is under active investigation. Verify before depositing. Do not deposit any money. Based on  | Soften the wording to the classification’s register, or record the regulator warning / victim reports that would justify it. |
| critical | `STRONG_CLAIM_UNSOURCED` — The article makes 1 allegation(s) requiring external support (regulator_action) but carries no sources or citations. First: "ASIC and Austria's FMA have both issued warning". | `sources` | ["ASIC and Austria's FMA have both issued warning"] | Attach the source for each allegation, or remove the allegation. |
| warning | `METRIC_HARDCODED` — 4 public figures impersonated matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `public_figures_impersonated` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `PRIMARY_DOMAIN_MISSING` — No primary domain recorded. 11 landing hostname(s) observed, but those are cloaked ad landers and must be confirmed by an analyst before publication — top candidate: seriapamo.top. | `primary_domain` | ["seriapamo.top","get-access.space","marketline.technology","nanonevio.top","quanta-gear.site"] | An analyst must confirm the platform’s own domain. Landing hostnames are cloaked landers and must not be used. |
