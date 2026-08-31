# Investigation dataset audit — Phase 1

Generated 2026-08-31T10:36:21.184Z against 34 investigations.

**Read-only.** No row was modified. Every entry below needs a human decision, and the
recommended action is a suggestion, not something the tooling applied.

- Investigations that would FAIL the publish gate today: **0 / 34**
- Investigations with zero findings: **1**

## Findings by code

| Severity | Code | Count |
|---|---|---:|
| warning | `METRIC_HARDCODED` | 97 |
| warning | `PRIMARY_DOMAIN_MISSING` | 32 |
| warning | `AMBIGUOUS_PARAGRAPH_OPENER` | 8 |
| warning | `DUPLICATE_TEXT_BLOCK` | 5 |

## Internal-link opportunities (page types that do not exist yet)

No links were created for these. Recorded here as Phase 2 scope.

| Wanted page type | Links it would carry |
|---|---:|
| `public_figure` | 146 |
| `country` | 115 |

## Per-investigation detail

### `/review/affitto-casa-immobiliare`

Status: published · score 7/100 (live brand 7) · LIMITED_EVIDENCE · publishable today: **yes**

| Severity | Issue | Field | Current value(s) | Recommended action |
|---|---|---|---|---|
| warning | `PRIMARY_DOMAIN_MISSING` — No primary domain recorded. 9 landing hostname(s) observed, but those are cloaked ad landers and must be confirmed by an analyst before publication — top candidate: portafoglio.protocollo-finanziario.it. | `primary_domain` | ["portafoglio.protocollo-finanziario.it","analisi.flash-notizie-it.com","capitaleplus.protocollo-finanziario.it","consulenza.riscatto-italiano.it","cultura.flas | An analyst must confirm the platform’s own domain. Landing hostnames are cloaked landers and must not be used. |

### `/review/afriquant-ai`

Status: published · score 3/100 (live brand 3) · LIMITED_EVIDENCE · publishable today: **yes**

| Severity | Issue | Field | Current value(s) | Recommended action |
|---|---|---|---|---|
| warning | `METRIC_HARDCODED` — 48 creatives observed matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `creatives_observed` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `PRIMARY_DOMAIN_MISSING` — No primary domain recorded. 4 landing hostname(s) observed, but those are cloaked ad landers and must be confirmed by an analyst before publication — top candidate: thrynexis.com. | `primary_domain` | ["thrynexis.com","vorythix.com","myrthex.com","pyrisan.com"] | An analyst must confirm the platform’s own domain. Landing hostnames are cloaked landers and must not be used. |

### `/review/blackrose-finbitnex`

Status: published · score 26/100 (live brand 26) · UNDER_INVESTIGATION · publishable today: **yes**

| Severity | Issue | Field | Current value(s) | Recommended action |
|---|---|---|---|---|
| warning | `METRIC_HARDCODED` — 324 days active matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `days_active` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `METRIC_HARDCODED` — 11 countries targeted matches the canonical value today but is a literal in alternative_headline and will drift the next time the scraper runs. | `countries_targeted` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `METRIC_HARDCODED` — 76 public figures impersonated matches the canonical value today but is a literal in meta_description and will drift the next time the scraper runs. | `public_figures_impersonated` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `METRIC_HARDCODED` — 314 creatives observed matches the canonical value today but is a literal in meta_description and will drift the next time the scraper runs. | `creatives_observed` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `PRIMARY_DOMAIN_MISSING` — No primary domain recorded. 18 landing hostname(s) observed, but those are cloaked ad landers and must be confirmed by an analyst before publication — top candidate: brokjawnightsalmon.com. | `primary_domain` | ["brokjawnightsalmon.com","noisetextbookmale.com","chickprinterschool.com","enchantedriddle.info","faithfulness.organiccheek.com"] | An analyst must confirm the platform’s own domain. Landing hostnames are cloaked landers and must not be used. |

### `/review/capbit`

Status: published · score 3/100 (live brand 3) · LIMITED_EVIDENCE · publishable today: **yes**

| Severity | Issue | Field | Current value(s) | Recommended action |
|---|---|---|---|---|
| warning | `PRIMARY_DOMAIN_MISSING` — No primary domain recorded. 8 landing hostname(s) observed, but those are cloaked ad landers and must be confirmed by an analyst before publication — top candidate: wafaluremied.xyz. | `primary_domain` | ["wafaluremied.xyz","enoruekavel.info","zolpaerani.info","firaenyodela.xyz","vesomiratu.pro"] | An analyst must confirm the platform’s own domain. Landing hostnames are cloaked landers and must not be used. |

### `/review/crest-fundgrove`

Status: published · score 5/100 (live brand 5) · LIMITED_EVIDENCE · publishable today: **yes**

| Severity | Issue | Field | Current value(s) | Recommended action |
|---|---|---|---|---|
| warning | `METRIC_HARDCODED` — 97 days active matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `days_active` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `METRIC_HARDCODED` — 13 public figures impersonated matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `public_figures_impersonated` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `METRIC_HARDCODED` — 69 creatives observed matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `creatives_observed` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `PRIMARY_DOMAIN_MISSING` — No primary domain recorded. 9 landing hostname(s) observed, but those are cloaked ad landers and must be confirmed by an analyst before publication — top candidate: gwemikazrol.pro. | `primary_domain` | ["gwemikazrol.pro","canadnewsroomt365.com","currentaffairs24.com","meridantiro.com","radiantless.top"] | An analyst must confirm the platform’s own domain. Landing hostnames are cloaked landers and must not be used. |

### `/review/equiloompro`

Status: published · score 34/100 (live brand 34) · UNDER_INVESTIGATION · publishable today: **yes**

| Severity | Issue | Field | Current value(s) | Recommended action |
|---|---|---|---|---|
| warning | `METRIC_HARDCODED` — 318 days active matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `days_active` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `METRIC_HARDCODED` — 20 countries targeted matches the canonical value today but is a literal in alternative_headline and will drift the next time the scraper runs. | `countries_targeted` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `METRIC_HARDCODED` — 99 public figures impersonated matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `public_figures_impersonated` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `METRIC_HARDCODED` — 398 creatives observed matches the canonical value today but is a literal in meta_description and will drift the next time the scraper runs. | `creatives_observed` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `PRIMARY_DOMAIN_MISSING` — No primary domain recorded. 15 landing hostname(s) observed, but those are cloaked ad landers and must be confirmed by an analyst before publication — top candidate: threnoxavelia.com. | `primary_domain` | ["threnoxavelia.com","zenithmaxisynergix.com","falverostniz.sbs","arakitrniopnt.com","branelovita.com"] | An analyst must confirm the platform’s own domain. Landing hostnames are cloaked landers and must not be used. |

### `/review/fino-inversor-a`

Status: published · score 8/100 (live brand 8) · LIMITED_EVIDENCE · publishable today: **yes**

| Severity | Issue | Field | Current value(s) | Recommended action |
|---|---|---|---|---|
| warning | `METRIC_HARDCODED` — 164 days active matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `days_active` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `METRIC_HARDCODED` — 11 public figures impersonated matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `public_figures_impersonated` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `METRIC_HARDCODED` — 93 creatives observed matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `creatives_observed` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `PRIMARY_DOMAIN_MISSING` — No primary domain recorded. 10 landing hostname(s) observed, but those are cloaked ad landers and must be confirmed by an analyst before publication — top candidate: breakingless.pro. | `primary_domain` | ["breakingless.pro","rentasolidames.com","elmundoaldiaty.top","elmundodump.top","actualidadenvivoo24.com"] | An analyst must confirm the platform’s own domain. Landing hostnames are cloaked landers and must not be used. |
| warning | `DUPLICATE_TEXT_BLOCK` — The same ~199-character passage appears in 1 places: "it impersonates 10 spanish celebrities without consent, deploys fake profit displays, and traps victim withdrawals throu". | `full_article (×2)` | — | Rewrite one of the duplicated passages; repeated blocks read as thin content. |
| warning | `DUPLICATE_TEXT_BLOCK` — The same ~199-character passage appears in 1 places: "common questions about fino inversoría's operations, regulatory status, recovery options, and warning signs are answered". | `full_article (×2)` | — | Rewrite one of the duplicated passages; repeated blocks read as thin content. |
| warning | `AMBIGUOUS_PARAGRAPH_OPENER` — 1 extractable passage(s) open with an unexplained pronoun, so they lose their subject when lifted on their own. First: "The platform falsely associated itself with at least 10 Spanish public figures, including Pablo Motos, Gloria Serra, Ama". | `full_article` | ["The platform falsely associated itself with at least 10 Spanish public figures, including Pablo Motos, Gloria Serra, Amancio Ortega, Daniel Lacalle, and José  | Rewrite the opening clause to name its subject so the passage survives extraction. |

### `/review/floventra`

Status: published · score 16/100 (live brand 16) · LIMITED_EVIDENCE · publishable today: **yes**

| Severity | Issue | Field | Current value(s) | Recommended action |
|---|---|---|---|---|
| warning | `METRIC_HARDCODED` — 140 days active matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `days_active` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `METRIC_HARDCODED` — 15 countries targeted matches the canonical value today but is a literal in alternative_headline and will drift the next time the scraper runs. | `countries_targeted` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `METRIC_HARDCODED` — 31 public figures impersonated matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `public_figures_impersonated` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `METRIC_HARDCODED` — 61 creatives observed matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `creatives_observed` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `PRIMARY_DOMAIN_MISSING` — No primary domain recorded. 17 landing hostname(s) observed, but those are cloaked ad landers and must be confirmed by an analyst before publication — top candidate: altemorivansolaretixa.click. | `primary_domain` | ["altemorivansolaretixa.click","hic-error-omnis.top","marvexilndatawx.click","orvalentamersolivarexa.click","plavironlayerx.club"] | An analyst must confirm the platform’s own domain. Landing hostnames are cloaked landers and must not be used. |
| warning | `DUPLICATE_TEXT_BLOCK` — The same ~159-character passage appears in 2 places: "cryptokiller detected {{stat:ad_creatives}} ad creatives impersonating {{stat:celebrities_abused}} public figures across". | `summary + faq[0].answer` | — | Rewrite one of the duplicated passages; repeated blocks read as thin content. |
| warning | `DUPLICATE_TEXT_BLOCK` — The same ~159-character passage appears in 1 places: "cryptokiller detected {{stat:ad_creatives}} ad creatives impersonating {{stat:celebrities_abused}} public figures across". | `full_article (×2)` | — | Rewrite one of the duplicated passages; repeated blocks read as thin content. |

### `/review/gaspipe-ai`

Status: published · score 16/100 (live brand 16) · LIMITED_EVIDENCE · publishable today: **yes**

| Severity | Issue | Field | Current value(s) | Recommended action |
|---|---|---|---|---|
| warning | `METRIC_HARDCODED` — 335 days active matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `days_active` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `METRIC_HARDCODED` — 5 countries targeted matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `countries_targeted` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `METRIC_HARDCODED` — 7 public figures impersonated matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `public_figures_impersonated` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `METRIC_HARDCODED` — 204 creatives observed matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `creatives_observed` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `PRIMARY_DOMAIN_MISSING` — No primary domain recorded. 11 landing hostname(s) observed, but those are cloaked ad landers and must be confirmed by an analyst before publication — top candidate: invest-at-consequatur.top. | `primary_domain` | ["invest-at-consequatur.top","concernanything.com","revisenotices.info","xe.aitradehu.com","fa.aipenzre.com"] | An analyst must confirm the platform’s own domain. Landing hostnames are cloaked landers and must not be used. |

### `/review/halal-trade-ai`

Status: published · score 17/100 (live brand 17) · LIMITED_EVIDENCE · publishable today: **yes**

| Severity | Issue | Field | Current value(s) | Recommended action |
|---|---|---|---|---|
| warning | `METRIC_HARDCODED` — 206 days active matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `days_active` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `METRIC_HARDCODED` — 4 countries targeted matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `countries_targeted` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `METRIC_HARDCODED` — 53 public figures impersonated matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `public_figures_impersonated` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `METRIC_HARDCODED` — 355 creatives observed matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `creatives_observed` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `PRIMARY_DOMAIN_MISSING` — No primary domain recorded. 10 landing hostname(s) observed, but those are cloaked ad landers and must be confirmed by an analyst before publication — top candidate: internationalnewswire.info. | `primary_domain` | ["internationalnewswire.info","globalnewsinsight.info","trivoxnet.info","newsfocusdaily.info","hyperconversionhub.click"] | An analyst must confirm the platform’s own domain. Landing hostnames are cloaked landers and must not be used. |
| warning | `AMBIGUOUS_PARAGRAPH_OPENER` — 1 extractable passage(s) open with an unexplained pronoun, so they lose their subject when lifted on their own. First: "The platform may demand additional payments labeled as Sharia compliance fees or processing charges.". | `full_article` | ["The platform may demand additional payments labeled as Sharia compliance fees or processing charges."] | Rewrite the opening clause to name its subject so the passage survives extraction. |

### `/review/immediate-bienestar`

Status: published · score 21/100 (live brand 21) · UNDER_INVESTIGATION · publishable today: **yes**

| Severity | Issue | Field | Current value(s) | Recommended action |
|---|---|---|---|---|
| warning | `METRIC_HARDCODED` — 15 countries targeted matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `countries_targeted` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `METRIC_HARDCODED` — 61 public figures impersonated matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `public_figures_impersonated` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `METRIC_HARDCODED` — 191 creatives observed matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `creatives_observed` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `PRIMARY_DOMAIN_MISSING` — No primary domain recorded. 13 landing hostname(s) observed, but those are cloaked ad landers and must be confirmed by an analyst before publication — top candidate: unfriempcf.com. | `primary_domain` | ["unfriempcf.com","fearfuuafh.com","countratvz.com","williatpzg.com","bankggkw.com"] | An analyst must confirm the platform’s own domain. Landing hostnames are cloaked landers and must not be used. |
| warning | `AMBIGUOUS_PARAGRAPH_OPENER` — 1 extractable passage(s) open with an unexplained pronoun, so they lose their subject when lifted on their own. First: "The platform directs victims through cloned landing pages designed to mimic legitimate cryptocurrency exchanges. Once us". | `full_article` | ["The platform directs victims through cloned landing pages designed to mimic legitimate cryptocurrency exchanges. Once users deposit funds, the system displays | Rewrite the opening clause to name its subject so the passage survives extraction. |

### `/review/immediate-connect`

Status: published · score 16/100 (live brand 16) · LIMITED_EVIDENCE · publishable today: **yes**

| Severity | Issue | Field | Current value(s) | Recommended action |
|---|---|---|---|---|
| warning | `METRIC_HARDCODED` — 337 days active matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `days_active` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `METRIC_HARDCODED` — 4 countries targeted matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `countries_targeted` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `METRIC_HARDCODED` — 15 public figures impersonated matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `public_figures_impersonated` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `METRIC_HARDCODED` — 116 creatives observed matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `creatives_observed` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `PRIMARY_DOMAIN_MISSING` — No primary domain recorded. 17 landing hostname(s) observed, but those are cloaked ad landers and must be confirmed by an analyst before publication — top candidate: chendisplayed.com. | `primary_domain` | ["chendisplayed.com","esxgrokcom.com","etyspacexing.com","blackwrensblood.com","enniestavil.com"] | An analyst must confirm the platform’s own domain. Landing hostnames are cloaked landers and must not be used. |
| warning | `AMBIGUOUS_PARAGRAPH_OPENER` — 2 extractable passage(s) open with an unexplained pronoun, so they lose their subject when lifted on their own. First: "These ads target users in Germany, India, and Italy through Facebook and Instagram placements, redirecting to disposable". | `full_article` | ["These ads target users in Germany, India, and Italy through Facebook and Instagram placements, redirecting to disposable landing pages like melonitg.com and d | Rewrite the opening clause to name its subject so the passage survives extraction. |

### `/review/immediate-v4-intal`

Status: published · score 24/100 (live brand 24) · UNDER_INVESTIGATION · publishable today: **yes**

| Severity | Issue | Field | Current value(s) | Recommended action |
|---|---|---|---|---|
| warning | `METRIC_HARDCODED` — 331 days active matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `days_active` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `METRIC_HARDCODED` — 12 countries targeted matches the canonical value today but is a literal in alternative_headline and will drift the next time the scraper runs. | `countries_targeted` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `METRIC_HARDCODED` — 56 public figures impersonated matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `public_figures_impersonated` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `METRIC_HARDCODED` — 177 creatives observed matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `creatives_observed` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `PRIMARY_DOMAIN_MISSING` — No primary domain recorded. 13 landing hostname(s) observed, but those are cloaked ad landers and must be confirmed by an analyst before publication — top candidate: amiablekap.org. | `primary_domain` | ["amiablekap.org","mechanssqo.com","hikepqot.com","medicojwzc.com","publicummk.com"] | An analyst must confirm the platform’s own domain. Landing hostnames are cloaked landers and must not be used. |

### `/review/investbot`

Status: published · score 19/100 (live brand 19) · LIMITED_EVIDENCE · publishable today: **yes**

| Severity | Issue | Field | Current value(s) | Recommended action |
|---|---|---|---|---|
| warning | `METRIC_HARDCODED` — 338 days active matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `days_active` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `METRIC_HARDCODED` — 8 countries targeted matches the canonical value today but is a literal in meta_description and will drift the next time the scraper runs. | `countries_targeted` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `METRIC_HARDCODED` — 353 creatives observed matches the canonical value today but is a literal in expertise_depth and will drift the next time the scraper runs. | `creatives_observed` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `PRIMARY_DOMAIN_MISSING` — No primary domain recorded. 12 landing hostname(s) observed, but those are cloaked ad landers and must be confirmed by an analyst before publication — top candidate: wa-booster.world. | `primary_domain` | ["wa-booster.world","anboosters.info","silverspindleses.space","pomaverilo.space","candlehuntinvst.com"] | An analyst must confirm the platform’s own domain. Landing hostnames are cloaked landers and must not be used. |
| warning | `AMBIGUOUS_PARAGRAPH_OPENER` — 2 extractable passage(s) open with an unexplained pronoun, so they lose their subject when lifted on their own. First: "These ads promise automated trading profits through AI-powered software, exploiting interest in passive income across em". | `full_article` | ["These ads promise automated trading profits through AI-powered software, exploiting interest in passive income across emerging markets.","These figures bear n | Rewrite the opening clause to name its subject so the passage survives extraction. |

### `/review/justo-credovia`

Status: published · score 5/100 (live brand 5) · LIMITED_EVIDENCE · publishable today: **yes**

| Severity | Issue | Field | Current value(s) | Recommended action |
|---|---|---|---|---|
| warning | `METRIC_HARDCODED` — 97 days active matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `days_active` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `METRIC_HARDCODED` — 13 public figures impersonated matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `public_figures_impersonated` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `METRIC_HARDCODED` — 42 creatives observed matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `creatives_observed` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `PRIMARY_DOMAIN_MISSING` — No primary domain recorded. 10 landing hostname(s) observed, but those are cloaked ad landers and must be confirmed by an analyst before publication — top candidate: elmundoreportajes24.com. | `primary_domain` | ["elmundoreportajes24.com","zenturbakoli.info","dailycanareportx.com","mdridnoticiasdiarias.com","noticiasinvestiga24.com"] | An analyst must confirm the platform’s own domain. Landing hostnames are cloaked landers and must not be used. |

### `/review/kaspi-ai`

Status: published · score 9/100 (live brand 9) · LIMITED_EVIDENCE · publishable today: **yes**

| Severity | Issue | Field | Current value(s) | Recommended action |
|---|---|---|---|---|
| warning | `METRIC_HARDCODED` — 197 days active matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `days_active` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `METRIC_HARDCODED` — 1 countries targeted matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `countries_targeted` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `METRIC_HARDCODED` — 9 public figures impersonated matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `public_figures_impersonated` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `METRIC_HARDCODED` — 175 creatives observed matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `creatives_observed` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `PRIMARY_DOMAIN_MISSING` — No primary domain recorded. 16 landing hostname(s) observed, but those are cloaked ad landers and must be confirmed by an analyst before publication — top candidate: meetaltivora.store. | `primary_domain` | ["meetaltivora.store","stavio.shop","sworble.store","xaqejag.com","getnordex.shop"] | An analyst must confirm the platform’s own domain. Landing hostnames are cloaked landers and must not be used. |

### `/review/legacy-bitfundex`

Status: published · score 38/100 (live brand 38) · UNDER_INVESTIGATION · publishable today: **yes**

| Severity | Issue | Field | Current value(s) | Recommended action |
|---|---|---|---|---|
| warning | `PRIMARY_DOMAIN_MISSING` — No primary domain recorded. 15 landing hostname(s) observed, but those are cloaked ad landers and must be confirmed by an analyst before publication — top candidate: thinkablepigeon.com. | `primary_domain` | ["thinkablepigeon.com","cautiousbravery.info","ninenest.info","azurewater.info","colossalsushi.com"] | An analyst must confirm the platform’s own domain. Landing hostnames are cloaked landers and must not be used. |

### `/review/nezertronixpro`

Status: published · score 26/100 (live brand 26) · UNDER_INVESTIGATION · publishable today: **yes**

| Severity | Issue | Field | Current value(s) | Recommended action |
|---|---|---|---|---|
| warning | `METRIC_HARDCODED` — 169 days active matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `days_active` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `METRIC_HARDCODED` — 26 countries targeted matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `countries_targeted` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `METRIC_HARDCODED` — 70 public figures impersonated matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `public_figures_impersonated` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `METRIC_HARDCODED` — 100 creatives observed matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `creatives_observed` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `PRIMARY_DOMAIN_MISSING` — No primary domain recorded. 11 landing hostname(s) observed, but those are cloaked ad landers and must be confirmed by an analyst before publication — top candidate: bilaltradingco.com. | `primary_domain` | ["bilaltradingco.com","reloadingexpert.com","beee2beesuniversity.com","the-dice-box.com","afiniti-consultants.com"] | An analyst must confirm the platform’s own domain. Landing hostnames are cloaked landers and must not be used. |
| warning | `AMBIGUOUS_PARAGRAPH_OPENER` — 2 extractable passage(s) open with an unexplained pronoun, so they lose their subject when lifted on their own. First: "These intermediary pages typically collect personal data — name, phone, email — and prompt an initial deposit.". | `full_article` | ["These intermediary pages typically collect personal data — name, phone, email — and prompt an initial deposit.","The platform may go offline without warning." | Rewrite the opening clause to name its subject so the passage survives extraction. |

### `/review/nordiqo`

Status: published · score 21/100 (live brand 21) · UNDER_INVESTIGATION · publishable today: **yes**

| Severity | Issue | Field | Current value(s) | Recommended action |
|---|---|---|---|---|
| warning | `METRIC_HARDCODED` — 339 days active matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `days_active` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `METRIC_HARDCODED` — 11 countries targeted matches the canonical value today but is a literal in meta_description and will drift the next time the scraper runs. | `countries_targeted` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `METRIC_HARDCODED` — 11 public figures impersonated matches the canonical value today but is a literal in meta_description and will drift the next time the scraper runs. | `public_figures_impersonated` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `METRIC_HARDCODED` — 307 creatives observed matches the canonical value today but is a literal in alternative_headline and will drift the next time the scraper runs. | `creatives_observed` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `PRIMARY_DOMAIN_MISSING` — No primary domain recorded. 7 landing hostname(s) observed, but those are cloaked ad landers and must be confirmed by an analyst before publication — top candidate: articfinnews.com. | `primary_domain` | ["articfinnews.com","alnewsca.com","canadatodaywire.com","insdertack.world","makenowktack.world"] | An analyst must confirm the platform’s own domain. Landing hostnames are cloaked landers and must not be used. |

### `/review/peak-luxentria`

Status: published · score 1/100 (live brand 1) · LIMITED_EVIDENCE · publishable today: **yes**

| Severity | Issue | Field | Current value(s) | Recommended action |
|---|---|---|---|---|
| warning | `PRIMARY_DOMAIN_MISSING` — No primary domain recorded. 2 landing hostname(s) observed, but those are cloaked ad landers and must be confirmed by an analyst before publication — top candidate: sharpminddump.info. | `primary_domain` | ["sharpminddump.info","cleverlogicty.pro"] | An analyst must confirm the platform’s own domain. Landing hostnames are cloaked landers and must not be used. |

### `/review/prestara-nexor`

Status: published · score 8/100 (live brand 8) · LIMITED_EVIDENCE · publishable today: **yes**

| Severity | Issue | Field | Current value(s) | Recommended action |
|---|---|---|---|---|
| warning | `METRIC_HARDCODED` — 122 days active matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `days_active` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `METRIC_HARDCODED` — 26 public figures impersonated matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `public_figures_impersonated` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `METRIC_HARDCODED` — 111 creatives observed matches the canonical value today but is a literal in meta_description and will drift the next time the scraper runs. | `creatives_observed` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `PRIMARY_DOMAIN_MISSING` — No primary domain recorded. 11 landing hostname(s) observed, but those are cloaked ad landers and must be confirmed by an analyst before publication — top candidate: optimized-commerce-engine.cloud. | `primary_domain` | ["optimized-commerce-engine.cloud","innovation-commerce-hub.art","sales-acceleration-system.cloud","digital-growth-framework.pro","dynamic-marketing-system.digi | An analyst must confirm the platform’s own domain. Landing hostnames are cloaked landers and must not be used. |

### `/review/prestaranexor`

Status: published · score 4/100 (live brand 4) · LIMITED_EVIDENCE · publishable today: **yes**

| Severity | Issue | Field | Current value(s) | Recommended action |
|---|---|---|---|---|
| warning | `METRIC_HARDCODED` — 70 days active matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `days_active` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `METRIC_HARDCODED` — 2 countries targeted matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `countries_targeted` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `METRIC_HARDCODED` — 4 public figures impersonated matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `public_figures_impersonated` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `METRIC_HARDCODED` — 37 creatives observed matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `creatives_observed` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `PRIMARY_DOMAIN_MISSING` — No primary domain recorded. 7 landing hostname(s) observed, but those are cloaked ad landers and must be confirmed by an analyst before publication — top candidate: invertprogram.com. | `primary_domain` | ["invertprogram.com","programinversiones.com","revenurise.com","investteamworld.com","likemagenta.com"] | An analyst must confirm the platform’s own domain. Landing hostnames are cloaked landers and must not be used. |

### `/review/primeaura`

Status: published · score 46/100 (live brand 46) · ELEVATED_RISK · publishable today: **yes**

| Severity | Issue | Field | Current value(s) | Recommended action |
|---|---|---|---|---|
| warning | `METRIC_HARDCODED` — 34 countries targeted matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `countries_targeted` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `METRIC_HARDCODED` — 166 public figures impersonated matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `public_figures_impersonated` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `METRIC_HARDCODED` — 474 creatives observed matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `creatives_observed` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `PRIMARY_DOMAIN_MISSING` — No primary domain recorded. 22 landing hostname(s) observed, but those are cloaked ad landers and must be confirmed by an analyst before publication — top candidate: cashinkaro.com. | `primary_domain` | ["cashinkaro.com","farbfotos.com","timesofmalta.site","affordablecleaningservicerichmond.com","brookesbodybutta.com"] | An analyst must confirm the platform’s own domain. Landing hostnames are cloaked landers and must not be used. |

### `/review/quantum`

Status: draft · score 29/100 (live brand 29) · UNDER_INVESTIGATION · publishable today: **yes**

| Severity | Issue | Field | Current value(s) | Recommended action |
|---|---|---|---|---|
| warning | `METRIC_HARDCODED` — 20 countries targeted matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `countries_targeted` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `METRIC_HARDCODED` — 48 public figures impersonated matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `public_figures_impersonated` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `METRIC_HARDCODED` — 417 creatives observed matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `creatives_observed` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `PRIMARY_DOMAIN_MISSING` — No primary domain recorded. 16 landing hostname(s) observed, but those are cloaked ad landers and must be confirmed by an analyst before publication — top candidate: frquantummai.com. | `primary_domain` | ["frquantummai.com","newscando-lom.com","signalinfovive.com","sourcemediaactuelle.com","castlevistahouse.com"] | An analyst must confirm the platform’s own domain. Landing hostnames are cloaked landers and must not be used. |

### `/review/quarix-ai`

Status: published · score 8/100 (live brand 8) · LIMITED_EVIDENCE · publishable today: **yes**

| Severity | Issue | Field | Current value(s) | Recommended action |
|---|---|---|---|---|
| warning | `METRIC_HARDCODED` — 12 public figures impersonated matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `public_figures_impersonated` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `METRIC_HARDCODED` — 138 creatives observed matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `creatives_observed` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `PRIMARY_DOMAIN_MISSING` — No primary domain recorded. 10 landing hostname(s) observed, but those are cloaked ad landers and must be confirmed by an analyst before publication — top candidate: profit-marketing-platform.top. | `primary_domain` | ["profit-marketing-platform.top","advance-commerce-system.top","efficient-marketing-engine.art","peak-marketing-platform.top","convert-ecommerce-system.pro"] | An analyst must confirm the platform’s own domain. Landing hostnames are cloaked landers and must not be used. |

### `/review/senvix`

Status: published · score 47/100 (live brand 47) · ELEVATED_RISK · publishable today: **yes**

| Severity | Issue | Field | Current value(s) | Recommended action |
|---|---|---|---|---|
| warning | `METRIC_HARDCODED` — 338 days active matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `days_active` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `METRIC_HARDCODED` — 18 countries targeted matches the canonical value today but is a literal in alternative_headline and will drift the next time the scraper runs. | `countries_targeted` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `METRIC_HARDCODED` — 107 public figures impersonated matches the canonical value today but is a literal in alternative_headline and will drift the next time the scraper runs. | `public_figures_impersonated` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `METRIC_HARDCODED` — 1278 creatives observed matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `creatives_observed` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `PRIMARY_DOMAIN_MISSING` — No primary domain recorded. 25 landing hostname(s) observed, but those are cloaked ad landers and must be confirmed by an analyst before publication — top candidate: internet-sicurezza.novita-informazioni.com. | `primary_domain` | ["internet-sicurezza.novita-informazioni.com","monexa.pri-tooth.com","omelix.pri-tooth.com","vyntro.pri-tooth.com","bitcomyl.vip"] | An analyst must confirm the platform’s own domain. Landing hostnames are cloaked landers and must not be used. |

### `/review/thistle-gainmere`

Status: published · score 1/100 (live brand 1) · LIMITED_EVIDENCE · publishable today: **yes**

| Severity | Issue | Field | Current value(s) | Recommended action |
|---|---|---|---|---|
| warning | `PRIMARY_DOMAIN_MISSING` — No primary domain recorded. 2 landing hostname(s) observed, but those are cloaked ad landers and must be confirmed by an analyst before publication — top candidate: candeloraqi.info. | `primary_domain` | ["candeloraqi.info","fieroenogauca.xyz"] | An analyst must confirm the platform’s own domain. Landing hostnames are cloaked landers and must not be used. |

### `/review/trade-vector-ai`

Status: published · score 42/100 (live brand 42) · ELEVATED_RISK · publishable today: **yes**

| Severity | Issue | Field | Current value(s) | Recommended action |
|---|---|---|---|---|
| warning | `METRIC_HARDCODED` — 338 days active matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `days_active` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `METRIC_HARDCODED` — 24 countries targeted matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `countries_targeted` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `METRIC_HARDCODED` — 136 public figures impersonated matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `public_figures_impersonated` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `METRIC_HARDCODED` — 596 creatives observed matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `creatives_observed` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |

### `/review/tradegpt`

Status: published · score 21/100 (live brand 21) · UNDER_INVESTIGATION · publishable today: **yes**

| Severity | Issue | Field | Current value(s) | Recommended action |
|---|---|---|---|---|
| warning | `METRIC_HARDCODED` — 338 days active matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `days_active` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `METRIC_HARDCODED` — 17 countries targeted matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `countries_targeted` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `METRIC_HARDCODED` — 14 public figures impersonated matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `public_figures_impersonated` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `METRIC_HARDCODED` — 90 creatives observed matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `creatives_observed` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `PRIMARY_DOMAIN_MISSING` — No primary domain recorded. 5 landing hostname(s) observed, but those are cloaked ad landers and must be confirmed by an analyst before publication — top candidate: dromexo.com. | `primary_domain` | ["dromexo.com","brimonto.com","meta-bananago.com","trk.sandoxaro.com","zylopare.com"] | An analyst must confirm the platform’s own domain. Landing hostnames are cloaked landers and must not be used. |
| warning | `DUPLICATE_TEXT_BLOCK` — The same ~253-character passage appears in 1 places: "investigation data shows 77 fraudulent advertisements targeting cryptocurrency traders through celebrity impersonation, ". | `full_article (×2)` | — | Rewrite one of the duplicated passages; repeated blocks read as thin content. |

### `/review/visi-n-luxovel`

Status: published · score 5/100 (live brand 5) · LIMITED_EVIDENCE · publishable today: **yes**

| Severity | Issue | Field | Current value(s) | Recommended action |
|---|---|---|---|---|
| warning | `METRIC_HARDCODED` — 92 days active matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `days_active` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `METRIC_HARDCODED` — 11 public figures impersonated matches the canonical value today but is a literal in meta_description and will drift the next time the scraper runs. | `public_figures_impersonated` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `METRIC_HARDCODED` — 36 creatives observed matches the canonical value today but is a literal in meta_description and will drift the next time the scraper runs. | `creatives_observed` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `PRIMARY_DOMAIN_MISSING` — No primary domain recorded. 13 landing hostname(s) observed, but those are cloaked ad landers and must be confirmed by an analyst before publication — top candidate: elinformadordiario24.com. | `primary_domain` | ["elinformadordiario24.com","polvarina24.pro","solvarineta.pro","alynodermisu.info","drapoxinelku.info"] | An analyst must confirm the platform’s own domain. Landing hostnames are cloaked landers and must not be used. |
| warning | `AMBIGUOUS_PARAGRAPH_OPENER` — 3 extractable passage(s) open with an unexplained pronoun, so they lose their subject when lifted on their own. First: "These ads target Spain exclusively through Facebook placements.". | `full_article` | ["These ads target Spain exclusively through Facebook placements.","These landing URLs contain extensive tracking parameters (campaign_id, adset_id, ad_id) typi | Rewrite the opening clause to name its subject so the passage survives extraction. |

### `/review/vlna-kapitisk`

Status: published · score 2/100 (live brand 2) · LIMITED_EVIDENCE · publishable today: **yes**

| Severity | Issue | Field | Current value(s) | Recommended action |
|---|---|---|---|---|
| warning | `METRIC_HARDCODED` — 41 days active matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `days_active` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `METRIC_HARDCODED` — 6 public figures impersonated matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `public_figures_impersonated` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `METRIC_HARDCODED` — 19 creatives observed matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `creatives_observed` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `PRIMARY_DOMAIN_MISSING` — No primary domain recorded. 5 landing hostname(s) observed, but those are cloaked ad landers and must be confirmed by an analyst before publication — top candidate: uentarqivox.pro. | `primary_domain` | ["uentarqivox.pro","nexusmediad.top","quantumnewsd.pro","seznpravien.com","crystalclearalerts.info"] | An analyst must confirm the platform’s own domain. Landing hostnames are cloaked landers and must not be used. |

### `/review/whatsapp-ai`

Status: published · score 28/100 (live brand 28) · UNDER_INVESTIGATION · publishable today: **yes**

| Severity | Issue | Field | Current value(s) | Recommended action |
|---|---|---|---|---|
| warning | `METRIC_HARDCODED` — 332 days active matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `days_active` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `METRIC_HARDCODED` — 20 countries targeted matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `countries_targeted` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `METRIC_HARDCODED` — 22 public figures impersonated matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `public_figures_impersonated` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `METRIC_HARDCODED` — 503 creatives observed matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `creatives_observed` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `PRIMARY_DOMAIN_MISSING` — No primary domain recorded. 11 landing hostname(s) observed, but those are cloaked ad landers and must be confirmed by an analyst before publication — top candidate: aiwabot.site. | `primary_domain` | ["aiwabot.site","yptelea.hair","botwa.xyz","der-gasaretes.site","eu.gptpbot.com"] | An analyst must confirm the platform’s own domain. Landing hostnames are cloaked landers and must not be used. |
| warning | `AMBIGUOUS_PARAGRAPH_OPENER` — 2 extractable passage(s) open with an unexplained pronoun, so they lose their subject when lifted on their own. First: "These ads run across {{stat:countries_targeted}} countries, geo-targeted to Armenia, Bulgaria, Moldova, the Baltics, and". | `full_article` | ["These ads run across {{stat:countries_targeted}} countries, geo-targeted to Armenia, Bulgaria, Moldova, the Baltics, and others.","These pages typically colle | Rewrite the opening clause to name its subject so the passage survives extraction. |

### `/review/whatsapp-bot`

Status: published · score 21/100 (live brand 21) · UNDER_INVESTIGATION · publishable today: **yes**

| Severity | Issue | Field | Current value(s) | Recommended action |
|---|---|---|---|---|
| warning | `METRIC_HARDCODED` — 338 days active matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `days_active` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `METRIC_HARDCODED` — 13 countries targeted matches the canonical value today but is a literal in alternative_headline and will drift the next time the scraper runs. | `countries_targeted` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `METRIC_HARDCODED` — 4 public figures impersonated matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `public_figures_impersonated` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `METRIC_HARDCODED` — 254 creatives observed matches the canonical value today but is a literal in full_article and will drift the next time the scraper runs. | `creatives_observed` | — | Low priority: replace the literal with a {{stat:…}} token at the next regeneration. |
| warning | `PRIMARY_DOMAIN_MISSING` — No primary domain recorded. 11 landing hostname(s) observed, but those are cloaked ad landers and must be confirmed by an analyst before publication — top candidate: seriapamo.top. | `primary_domain` | ["seriapamo.top","get-access.space","marketline.technology","nanonevio.top","quanta-gear.site"] | An analyst must confirm the platform’s own domain. Landing hostnames are cloaked landers and must not be used. |
