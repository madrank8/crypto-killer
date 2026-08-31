# Remediation DRY-RUN plan — 2026-08-31T10:05:19.336Z

Policy: adopt live brand score; deterministic fixes only (waves A/B/C). 34 of 34 investigations change.

| Wave | What | Changes |
|---|---|---:|
| D | external corroboration recorded on the brand row (source-traceable, re-verified) | 4 |
| A0 | scam_score column := live brand score | 32 |
| A1 | old-score "N/100" literals | 327 |
| A2 | other threat-score "N/100" literals (context-gated) | 247 |
| B | metric literals + stale observation windows → canonical values | 220 |
| B-skip | day-counts next to unmatchable date windows — left for regeneration | 0 |
| C1 | fraud assertions → hedged register | 5 |
| C2 | sub-Elevated "Do not deposit" → verification directive | 19 |

## ⚠️ Band-crossers — priority queue for Wave-2 regeneration

The new score moves these into a different classification band. Deterministic fixes
align their numbers and register, but band-specific prose (tier labels baked into
sentences, verdict framing) needs a writer pass:

- `/review/equiloompro` — ELEVATED_RISK → UNDER_INVESTIGATION (43 → 34)
- `/review/halal-trade-ai` — UNDER_INVESTIGATION → LIMITED_EVIDENCE (25 → 17)
- `/review/immediate-connect` — UNDER_INVESTIGATION → LIMITED_EVIDENCE (25 → 16)
- `/review/investbot` — UNDER_INVESTIGATION → LIMITED_EVIDENCE (27 → 19)
- `/review/legacy-bitfundex` — ELEVATED_RISK → UNDER_INVESTIGATION (43 → 38)

## /review/affitto-casa-immobiliare  (published; score 6 → 7; LIMITED_EVIDENCE)

| Wave | Field | From | To |
|---|---|---|---|
| A0 | `scam_score` | 6 | 7 |
| A1 | `title` | 6/100 | 7/100 |
| A2 | `meta_description` | 3/100 _(Affitto Casa Immobiliare scores 3/100 on Crypto Killer's threat index. 3 red flags detected acros)_ | 7/100 |
| A2 | `summary` | 3/100 _(Affitto Casa Immobiliare shows limited signals in current surveillance data, scoring 3/100 on Crypto Killer's )_ | 7/100 |
| A1 | `full_article` | 6/100 | 7/100 |
| A1 | `full_article` | 6/100 | 7/100 |
| A1 | `full_article` | 6/100 | 7/100 |
| A1 | `full_article` | 6/100 | 7/100 |
| A1 | `full_article` | 6/100 | 7/100 |
| A1 | `full_article` | 6/100 | 7/100 |
| B | `full_article` | between Mar 13, 2026 and Apr 8, 2026 | between Mar 13, 2026 and Aug 13, 2026 |
| B | `full_article` | 26 days of continuous operation | 153 days of continuous operation |
| C2 | `full_article` | Do not deposit any money. _(ls. Ongoing monitoring. Do not deposit any money. <div style="border-top:1px solid rg)_ | Verify the platform’s regulatory status independently before depositing any money. |
| A2 | `key_takeaways[0]` | 3/100 _(Affitto Casa Immobiliare scores 3/100 on Crypto Killer's threat index, placing it in the low-sign)_ | 7/100 |
| A2 | `faq[0].answer` | 3/100 _(Affitto Casa Immobiliare scores 3/100 on Crypto Killer's threat index, placing it in the low-sign)_ | 7/100 |
| A2 | `schema_json` | 3/100 _(ryptokiller.org/review/affitto-casa-immobiliare","name":"Affitto Casa Immobiliare Review: 3/100 Threat Score [)_ | 7/100 |
| A2 | `schema_json` | 3/100 _(obiliare#breadcrumb"},"inLanguage":"en-US","description":"Affitto Casa Immobiliare scores 3/100 on Crypto Kill)_ | 7/100 |
| A2 | `schema_json` | 3/100 _(Casa Immobiliare","@type":"RealEstateAgent","description":"Platform under investigation. 3/100 threat score (l)_ | 7/100 |
| A2 | `schema_json` | 3/100 _(on"},"wordCount":1933,"inLanguage":"en-US","description":"Affitto Casa Immobiliare scores 3/100 on Crypto Kill)_ | 7/100 |
| A2 | `schema_json` | 3/100 _(alEstateAgent","description":"Platform under investigation by Crypto Killer. Threat score 3/100."},"datePublis)_ | 7/100 |
| A2 | `schema_json` | 3/100 _(are a scam?","@type":"Question","acceptedAnswer":{"text":"Affitto Casa Immobiliare scores 3/100 on Crypto Kill)_ | 7/100 |

## /review/afriquant-ai  (published; score 13 → 3; LIMITED_EVIDENCE)

| Wave | Field | From | To |
|---|---|---|---|
| A0 | `scam_score` | 13 | 3 |
| A1 | `title` | 13/100 | 3/100 |
| A2 | `meta_description` | 12/100 _(AfriQuant AI scores 12/100 on CryptoKiller's threat index. Surveillance data flags {{s)_ | 3/100 |
| A2 | `summary` | 12/100 _(AfriQuant AI shows limited signals in current surveillance data, scoring 12/100 on Crypto Killer's threat inde)_ | 3/100 |
| A1 | `full_article` | 13/100 | 3/100 |
| A1 | `full_article` | 13/100 | 3/100 |
| A1 | `full_article` | 13/100 | 3/100 |
| A1 | `full_article` | 13/100 | 3/100 |
| A1 | `full_article` | 13/100 | 3/100 |
| A1 | `full_article` | 13/100 | 3/100 |
| A1 | `full_article` | 13/100 | 3/100 |
| B | `full_article` | 30 ad creatives | 48 ad creatives |
| C1 | `full_article` | is a fraudulent scheme _(>📖 Frequently Asked Questions Is AfriQuant AI a legitimate trading platform? No. AfriQuant AI is a fraudulent)_ | displays the hallmarks of a fraudulent scheme |
| C2 | `full_article` | Do not deposit any money. _(ls. Ongoing monitoring. Do not deposit any money. <div style="border-top:1px solid rg)_ | Verify the platform’s regulatory status independently before depositing any money. |
| A2 | `not_for_you` | 12/100 _(involve a copycat. And the line a competitor won't print: AfriQuant AI currently scores 12/100 in our surveill)_ | 3/100 |
| A2 | `key_takeaways[0]` | 12/100 _(AfriQuant AI scores 12/100 on CryptoKiller's threat index, placing it in the Low Signa)_ | 3/100 |
| A2 | `schema_json` | 12/100 _(ebpage","url":"https://cryptokiller.org/review/afriquant-ai","name":"AfriQuant AI Review: 12/100 Threat Score )_ | 3/100 |
| A2 | `schema_json` | 12/100 _(/review/afriquant-ai#breadcrumb"},"inLanguage":"en-US","description":"AfriQuant AI scores 12/100 on CryptoKill)_ | 3/100 |
| A2 | `schema_json` | 12/100 _("name":"AfriQuant AI","@type":"Organization","description":"Platform under investigation. 12/100 threat score )_ | 3/100 |
| A2 | `schema_json` | 12/100 _(/#organization"},"wordCount":2513,"inLanguage":"en-US","description":"AfriQuant AI scores 12/100 on CryptoKill)_ | 3/100 |
| A2 | `schema_json` | 12/100 _("Organization","description":"Platform under investigation by Crypto Killer. Threat score 12/100."},"datePubli)_ | 3/100 |

## /review/blackrose-finbitnex  (published; score 25 → 26; UNDER_INVESTIGATION)

| Wave | Field | From | To |
|---|---|---|---|
| A0 | `scam_score` | 25 | 26 |
| A1 | `title` | 25/100 | 26/100 |
| A2 | `meta_description` | 33/100 _(Blackrose Finbitnex scores 33/100 on Crypto Killer's threat index. FSMA-blacklisted, 61 celeb)_ | 26/100 |
| B | `meta_description` | 61 celebrities | 76 celebrities |
| B | `meta_description` | 312 ad creatives | 314 ad creatives |
| A2 | `summary` | 33/100 _(lackrose Finbitnex is on Crypto Killer's watchlist pending further investigation, scoring 33/100 on Crypto Kil)_ | 26/100 |
| A1 | `full_article` | 25/100 | 26/100 |
| A1 | `full_article` | 25/100 | 26/100 |
| A1 | `full_article` | 25/100 | 26/100 |
| A1 | `full_article` | 25/100 | 26/100 |
| A1 | `full_article` | 25/100 | 26/100 |
| B | `full_article` | 61 celebrities | 76 celebrities |
| B | `full_article` | 61 Celebrities | 76 Celebrities |
| B | `full_article` | 312 ad creatives | 314 ad creatives |
| B | `full_article` | between Sep 23, 2025 and Apr 28, 2026 | between Sep 23, 2025 and Aug 13, 2026 |
| B | `full_article` | 217 days of continuous operation | 324 days of continuous operation |
| C2 | `full_article` | Do not deposit any money. _(rify before depositing. Do not deposit any money. <div style="border-top:1px solid rg)_ | Verify the platform’s regulatory status independently before depositing any money. |
| B | `red_flags[1].flag` | 61 Celebrities | 76 Celebrities |
| A2 | `schema_json` | 33/100 _("https://cryptokiller.org/review/blackrose-finbitnex","name":"Blackrose Finbitnex Review: 33/100 Threat Score )_ | 26/100 |
| A2 | `schema_json` | 33/100 _(ose-finbitnex#breadcrumb"},"inLanguage":"en-US","description":"Blackrose Finbitnex scores 33/100 on Crypto Kil)_ | 26/100 |
| A2 | `schema_json` | 33/100 _(ose Finbitnex","@type":"SoftwareApplication","description":"Platform under investigation. 33/100 threat score )_ | 26/100 |
| A2 | `schema_json` | 33/100 _(ization"},"wordCount":2261,"inLanguage":"en-US","description":"Blackrose Finbitnex scores 33/100 on Crypto Kil)_ | 26/100 |
| A2 | `schema_json` | 33/100 _(reApplication","description":"Platform under investigation by Crypto Killer. Threat score 33/100."},"reviewRat)_ | 26/100 |

## /review/capbit  (published; score 12 → 3; LIMITED_EVIDENCE)

| Wave | Field | From | To |
|---|---|---|---|
| A0 | `scam_score` | 12 | 3 |
| A1 | `alternative_headline` | 12/100 | 3/100 |
| A1 | `meta_description` | 12/100 | 3/100 |
| A1 | `summary` | 12/100 | 3/100 |
| A1 | `full_article` | 12/100 | 3/100 |
| A1 | `full_article` | 12/100 | 3/100 |
| A1 | `full_article` | 12/100 | 3/100 |
| A1 | `full_article` | 12/100 | 3/100 |
| A1 | `full_article` | 12/100 | 3/100 |
| A1 | `full_article` | 12/100 | 3/100 |
| A1 | `full_article` | 12/100 | 3/100 |
| A1 | `key_takeaways[0]` | 12/100 | 3/100 |
| A1 | `faq[0].answer` | 12/100 | 3/100 |
| A1 | `schema_json` | 12/100 | 3/100 |
| A1 | `schema_json` | 12/100 | 3/100 |
| A1 | `schema_json` | 12/100 | 3/100 |
| A1 | `schema_json` | 12/100 | 3/100 |
| A1 | `schema_json` | 12/100 | 3/100 |
| A1 | `schema_json` | 12/100 | 3/100 |

## /review/crest-fundgrove  (published; score 15 → 5; LIMITED_EVIDENCE)

| Wave | Field | From | To |
|---|---|---|---|
| A0 | `scam_score` | 15 | 5 |
| A1 | `title` | 15/100 | 5/100 |
| A2 | `meta_description` | 13/100 _(Crest Fundgrove scores 13/100 on Crypto Killer's threat index. Surveillance data shows ce)_ | 5/100 |
| A2 | `summary` | 13/100 _(Crest Fundgrove shows limited signals in current surveillance data, scoring 13/100 on Crypto Killer's threat i)_ | 5/100 |
| A1 | `full_article` | 15/100 | 5/100 |
| A1 | `full_article` | 15/100 | 5/100 |
| A1 | `full_article` | 15/100 | 5/100 |
| A1 | `full_article` | 15/100 | 5/100 |
| A1 | `full_article` | 15/100 | 5/100 |
| A1 | `full_article` | 15/100 | 5/100 |
| B | `full_article` | 9 celebrities | 13 celebrities |
| B | `full_article` | 47 ad creatives | 69 ad creatives |
| B | `full_article` | between May 8, 2026 and Jun 10, 2026 | between May 8, 2026 and Aug 13, 2026 |
| B | `full_article` | 32 days of continuous operation | 97 days of continuous operation |
| C2 | `full_article` | Do not deposit any money. _(ls. Ongoing monitoring. Do not deposit any money. <div style="border-top:1px solid rg)_ | Verify the platform’s regulatory status independently before depositing any money. |
| A2 | `key_takeaways[0]` | 13/100 _(Crest Fundgrove scores 13/100 on Crypto Killer's threat index, placing it in the Low Sign)_ | 5/100 |
| A2 | `faq[0].answer` | 13/100 _(confirmed scam designation, but it shows signals warranting caution. Its threat score is 13/100. Surveillance )_ | 5/100 |
| A2 | `schema_json` | 13/100 _(","url":"https://cryptokiller.org/review/crest-fundgrove","name":"Crest Fundgrove Review: 13/100 Threat Score )_ | 5/100 |
| A2 | `schema_json` | 13/100 _(w/crest-fundgrove#breadcrumb"},"inLanguage":"en-US","description":"Crest Fundgrove scores 13/100 on Crypto Kil)_ | 5/100 |
| A2 | `schema_json` | 13/100 _(":[{"name":"Crest Fundgrove","@type":"Thing","description":"Platform under investigation. 13/100 threat score )_ | 5/100 |
| A2 | `schema_json` | 13/100 _(rganization"},"wordCount":2067,"inLanguage":"en-US","description":"Crest Fundgrove scores 13/100 on Crypto Kil)_ | 5/100 |
| A2 | `schema_json` | 13/100 _(@type":"Thing","description":"Platform under investigation by Crypto Killer. Threat score 13/100."},"datePubli)_ | 5/100 |
| A2 | `schema_json` | 13/100 _(confirmed scam designation, but it shows signals warranting caution. Its threat score is 13/100. Surveillance )_ | 5/100 |

## /review/equiloompro  (published; score 43 → 34; UNDER_INVESTIGATION)

| Wave | Field | From | To |
|---|---|---|---|
| A0 | `scam_score` | 43 | 34 |
| A1 | `title` | 43/100 | 34/100 |
| B | `alternative_headline` | 17 Countries | 20 Countries |
| A2 | `meta_description` | 25/100 _(EquiLoomPRO scores 25/100 on Crypto Killer's threat index. 7 red flags identified acr)_ | 34/100 |
| B | `meta_description` | 17 countries | 20 countries |
| B | `meta_description` | 342 ad creatives | 398 ad creatives |
| A2 | `summary` | 25/100 _(EquiLoomPRO is on Crypto Killer's watchlist pending further investigation, scoring 25/100 on Crypto Killer's t)_ | 34/100 |
| A1 | `full_article` | 43/100 | 34/100 |
| A1 | `full_article` | 43/100 | 34/100 |
| A1 | `full_article` | 43/100 | 34/100 |
| A1 | `full_article` | 43/100 | 34/100 |
| A1 | `full_article` | 43/100 | 34/100 |
| A1 | `full_article` | 43/100 | 34/100 |
| A1 | `full_article` | 43/100 | 34/100 |
| B | `full_article` | 17 countries | 20 countries |
| B | `full_article` | 17 countries | 20 countries |
| B | `full_article` | 17 countries | 20 countries |
| B | `full_article` | 17 countries | 20 countries |
| B | `full_article` | 54 celebrities | 99 celebrities |
| B | `full_article` | 342 ad creatives | 398 ad creatives |
| B | `full_article` | between Sep 29, 2025 and Apr 1, 2026 | between Sep 29, 2025 and Aug 13, 2026 |
| B | `full_article` | 184 days of continuous operation | 318 days of continuous operation |
| C2 | `full_article` | Do not deposit any money. _(rify before depositing. Do not deposit any money. <div style="border-top:1px solid rg)_ | Verify the platform’s regulatory status independently before depositing any money. |
| B | `information_gain_summary` | 17 countries | 20 countries |
| B | `information_gain_summary` | 54 celebrities | 99 celebrities |
| B | `information_gain_summary` | 342 creatives | 398 creatives |
| A2 | `red_flags[3].detail` | 25/100 _(uiLoomPRO in the bottom quartile of all websites evaluated. Combined with Crypto Killer's 25/100 threat score )_ | 34/100 |
| A2 | `faq[0].answer` | 25/100 _(EquiLoomPRO appears on Crypto Killer's watchlist with a 25/100 threat score. BrokersView confirmed its FCA, CF)_ | 34/100 |
| A2 | `schema_json` | 25/100 _(#webpage","url":"https://cryptokiller.org/review/equiloompro","name":"EquiLoomPRO Review: 25/100 Threat Score )_ | 34/100 |
| A2 | `schema_json` | 25/100 _(rg/review/equiloompro#breadcrumb"},"inLanguage":"en-US","description":"EquiLoomPRO scores 25/100 on Crypto Kil)_ | 34/100 |
| A2 | `schema_json` | 25/100 _(:"EquiLoomPRO","@type":"SoftwareApplication","description":"Platform under investigation. 25/100 threat score )_ | 34/100 |
| A2 | `schema_json` | 25/100 _(g/#organization"},"wordCount":2207,"inLanguage":"en-US","description":"EquiLoomPRO scores 25/100 on Crypto Kil)_ | 34/100 |
| A2 | `schema_json` | 25/100 _(reApplication","description":"Platform under investigation by Crypto Killer. Threat score 25/100."},"reviewRat)_ | 34/100 |
| A2 | `schema_json` | 25/100 _(estion","acceptedAnswer":{"text":"EquiLoomPRO appears on Crypto Killer's watchlist with a 25/100 threat score.)_ | 34/100 |

## /review/fino-inversor-a  (published; score 17 → 8; LIMITED_EVIDENCE)

| Wave | Field | From | To |
|---|---|---|---|
| A0 | `scam_score` | 17 | 8 |
| A1 | `title` | 17/100 | 8/100 |
| A2 | `meta_description` | 16/100 _(Fino Inversoría scores 16/100 on CryptoKiller's threat index. Surveillance data flags cel)_ | 8/100 |
| A2 | `summary` | 16/100 _(Fino Inversoría shows limited signals in current surveillance data, scoring 16/100 on Crypto Killer's threat i)_ | 8/100 |
| A1 | `full_article` | 17/100 | 8/100 |
| A1 | `full_article` | 17/100 | 8/100 |
| A1 | `full_article` | 17/100 | 8/100 |
| A1 | `full_article` | 17/100 | 8/100 |
| A1 | `full_article` | 17/100 | 8/100 |
| A1 | `full_article` | 17/100 | 8/100 |
| A1 | `full_article` | 17/100 | 8/100 |
| A1 | `full_article` | 17/100 | 8/100 |
| A1 | `full_article` | 17/100 | 8/100 |
| A1 | `full_article` | 17/100 | 8/100 |
| B | `full_article` | 10 celebrities | 11 celebrities |
| B | `full_article` | 28 ad creatives | 93 ad creatives |
| B | `full_article` | 111 days of continuous operation | 164 days of continuous operation |
| B | `full_article` | 111 days of continuous operation | 164 days of continuous operation |
| B | `full_article` | 111 days of continuous operation | 164 days of continuous operation |
| C2 | `full_article` | Do not deposit any money. _(ls. Ongoing monitoring. Do not deposit any money. <div style="border-top:1px solid rg)_ | Verify the platform’s regulatory status independently before depositing any money. |
| A2 | `not_for_you` | 16/100 _(rectly. Here is a line most review sites skip: our current threat score for this brand is 16/100 (Low Signal) )_ | 8/100 |
| A2 | `key_takeaways[0]` | 16/100 _(Threat score stands at 16/100, placing Fino Inversoría in the low-signal tier under curre)_ | 8/100 |
| A2 | `faq[0].answer` | 16/100 _(Fino Inversoría shows limited signals at a threat score of 16/100 in current surveillance data. The platform h)_ | 8/100 |
| A2 | `schema_json` | 16/100 _(","url":"https://cryptokiller.org/review/fino-inversor-a","name":"Fino Inversoría Review: 16/100 Threat Score )_ | 8/100 |
| A2 | `schema_json` | 16/100 _(w/fino-inversor-a#breadcrumb"},"inLanguage":"en-US","description":"Fino Inversoría scores 16/100 on CryptoKill)_ | 8/100 |
| A2 | `schema_json` | 16/100 _(no Inversoría","@type":"SoftwareApplication","description":"Platform under investigation. 16/100 threat score )_ | 8/100 |
| A2 | `schema_json` | 16/100 _(rganization"},"wordCount":2436,"inLanguage":"en-US","description":"Fino Inversoría scores 16/100 on CryptoKill)_ | 8/100 |
| A2 | `schema_json` | 16/100 _(reApplication","description":"Platform under investigation by Crypto Killer. Threat score 16/100."},"datePubli)_ | 8/100 |
| A2 | `schema_json` | 16/100 _(ion","acceptedAnswer":{"text":"Fino Inversoría shows limited signals at a threat score of 16/100 in current su)_ | 8/100 |

## /review/floventra  (published; score 15 → 16; LIMITED_EVIDENCE)

| Wave | Field | From | To |
|---|---|---|---|
| A0 | `scam_score` | 15 | 16 |
| A1 | `title` | 15/100 | 16/100 |
| A2 | `meta_description` | 12/100 _(Floventra scores 12/100 on Crypto Killer's threat index. 4 red flags detected acros)_ | 16/100 |
| A2 | `summary` | 12/100 _(Floventra shows limited signals in current surveillance data, scoring 12/100 on Crypto Killer's threat index. )_ | 16/100 |
| A1 | `full_article` | 15/100 | 16/100 |
| A1 | `full_article` | 15/100 | 16/100 |
| A1 | `full_article` | 15/100 | 16/100 |
| A1 | `full_article` | 15/100 | 16/100 |
| A1 | `full_article` | 15/100 | 16/100 |
| A1 | `full_article` | 15/100 | 16/100 |
| B | `full_article` | 80 countries | 15 countries |
| B | `full_article` | 27 celebrities | 31 celebrities |
| B | `full_article` | 57 creatives | 61 creatives |
| B | `full_article` | 57 ad creatives | 61 ad creatives |
| B | `full_article` | between Mar 26, 2026 and Apr 24, 2026 | between Mar 26, 2026 and Aug 13, 2026 |
| B | `full_article` | 29 days of continuous operation | 140 days of continuous operation |
| C2 | `full_article` | Do not deposit any money. _(ls. Ongoing monitoring. Do not deposit any money. <div style="border-top:1px solid rg)_ | Verify the platform’s regulatory status independently before depositing any money. |
| B | `expertise_depth` | 80 countries | 15 countries |
| A2 | `key_takeaways[0]` | 12/100 _(Floventra scores 12/100 on Crypto Killer's threat index — low signal tier with ongo)_ | 16/100 |
| A2 | `schema_json` | 12/100 _(ntra#webpage","url":"https://cryptokiller.org/review/floventra","name":"Floventra Review: 12/100 Threat Score )_ | 16/100 |
| A2 | `schema_json` | 12/100 _(er.org/review/floventra#breadcrumb"},"inLanguage":"en-US","description":"Floventra scores 12/100 on Crypto Kil)_ | 16/100 |
| A2 | `schema_json` | 12/100 _(e":"Floventra","@type":"SoftwareApplication","description":"Platform under investigation. 12/100 threat score )_ | 16/100 |
| A2 | `schema_json` | 12/100 _(org/#organization"},"wordCount":1931,"inLanguage":"en-US","description":"Floventra scores 12/100 on Crypto Kil)_ | 16/100 |
| A2 | `schema_json` | 12/100 _(reApplication","description":"Platform under investigation by Crypto Killer. Threat score 12/100."},"datePubli)_ | 16/100 |

## /review/gaspipe-ai  (published; score 15 → 16; LIMITED_EVIDENCE)

| Wave | Field | From | To |
|---|---|---|---|
| A0 | `scam_score` | 15 | 16 |
| A1 | `title` | 15/100 | 16/100 |
| A1 | `meta_description` | 15/100 | 16/100 |
| A1 | `summary` | 15/100 | 16/100 |
| A1 | `full_article` | 15/100 | 16/100 |
| A1 | `full_article` | 15/100 | 16/100 |
| A1 | `full_article` | 15/100 | 16/100 |
| A1 | `full_article` | 15/100 | 16/100 |
| A1 | `full_article` | 15/100 | 16/100 |
| A1 | `full_article` | 15/100 | 16/100 |
| A1 | `full_article` | 15/100 | 16/100 |
| A1 | `full_article` | 15/100 | 16/100 |
| A1 | `full_article` | 15/100 | 16/100 |
| B | `full_article` | 202 ad creatives | 204 ad creatives |
| B | `full_article` | 202 ad creatives | 204 ad creatives |
| B | `full_article` | 297 days of continuous operation | 335 days of continuous operation |
| B | `full_article` | 297 days of continuous operation | 335 days of continuous operation |
| A1 | `expertise_depth` | 15/100 | 16/100 |
| A1 | `key_takeaways[0]` | 15/100 | 16/100 |
| A1 | `faq[0].answer` | 15/100 | 16/100 |
| A1 | `schema_json` | 15/100 | 16/100 |
| A1 | `schema_json` | 15/100 | 16/100 |
| A1 | `schema_json` | 15/100 | 16/100 |
| A1 | `schema_json` | 15/100 | 16/100 |
| A1 | `schema_json` | 15/100 | 16/100 |
| A1 | `schema_json` | 15/100 | 16/100 |
| A1 | `schema_json` | 15/100 | 16/100 |

## /review/halal-trade-ai  (published; score 25 → 17; LIMITED_EVIDENCE)

| Wave | Field | From | To |
|---|---|---|---|
| A0 | `scam_score` | 25 | 17 |
| A1 | `title` | 25/100 | 17/100 |
| A2 | `alternative_headline` | 20/100 _(Halal Trade AI Scores 20/100 on Crypto Killer's Threat Index — What Gulf Investors Shoul)_ | 17/100 |
| A2 | `meta_description` | 20/100 _(Halal Trade AI scores 20/100 on Crypto Killer's threat index. Our 2026 investigation fou)_ | 17/100 |
| A2 | `summary` | 20/100 _(Halal Trade AI is on Crypto Killer's watchlist pending further investigation, scoring 20/100 on Crypto Killer')_ | 17/100 |
| A1 | `full_article` | 25/100 | 17/100 |
| A1 | `full_article` | 25/100 | 17/100 |
| A1 | `full_article` | 25/100 | 17/100 |
| A1 | `full_article` | 25/100 | 17/100 |
| A1 | `full_article` | 25/100 | 17/100 |
| A1 | `full_article` | 25/100 | 17/100 |
| A2 | `full_article` | 20/100 _(ng راشد الماجد in AE"> راشد الماجد ⚠️ Threat Score 20/ 100 Watchlist Thr)_ | 17/100 |
| B | `full_article` | 3 countries | 4 countries |
| B | `full_article` | 3 countries | 4 countries |
| B | `full_article` | 3 countries | 4 countries |
| B | `full_article` | 3 countries | 4 countries |
| B | `full_article` | 30 celebrities | 53 celebrities |
| B | `full_article` | 30 public figures | 53 public figures |
| B | `full_article` | 138 creatives | 355 creatives |
| B | `full_article` | 138 ad creatives | 355 ad creatives |
| B | `full_article` | between Jan 19, 2026 and Jun 10, 2026 | between Jan 19, 2026 and Aug 13, 2026 |
| B | `full_article` | 141 days of continuous operation | 206 days of continuous operation |
| C2 | `full_article` | Do not deposit any money. _(rong>Halal Trade AI is under active investigation. Verify before depositing. Do not deposit any money. Based o)_ | Verify the platform’s regulatory status independently before depositing any money. |
| A2 | `key_takeaways[5]` | 20/100 _(Crypto Killer's threat score of 20/100 places Halal Trade AI on the watchlist tier — meaning red f)_ | 17/100 |
| B | `red_flags[0].flag` | 30 public figures | 53 public figures |
| B | `red_flags[1].flag` | 138 creatives | 355 creatives |
| A2 | `faq[0].answer` | 20/100 _(Halal Trade AI is under active investigation and carries a threat score of 20/100 on Crypto Killer's watchlist)_ | 17/100 |
| A2 | `schema_json` | 20/100 _(ge","url":"https://cryptokiller.org/review/halal-trade-ai","name":"Halal Trade AI Review: 20/100 Threat Score )_ | 17/100 |
| A2 | `schema_json` | 20/100 _(iew/halal-trade-ai#breadcrumb"},"inLanguage":"en-US","description":"Halal Trade AI scores 20/100 on Crypto Kil)_ | 17/100 |
| A2 | `schema_json` | 20/100 _(alal Trade AI","@type":"SoftwareApplication","description":"Platform under investigation. 20/100 threat score )_ | 17/100 |
| A2 | `schema_json` | 20/100 _(organization"},"wordCount":2506,"inLanguage":"en-US","description":"Halal Trade AI scores 20/100 on Crypto Kil)_ | 17/100 |
| A2 | `schema_json` | 20/100 _(tokiller.org/review/halal-trade-ai#webpage"},"alternativeHeadline":"Halal Trade AI Scores 20/100 on Crypto Kil)_ | 17/100 |
| A2 | `schema_json` | 20/100 _(reApplication","description":"Platform under investigation by Crypto Killer. Threat score 20/100."},"reviewRat)_ | 17/100 |
| A2 | `schema_json` | 20/100 _(swer":{"text":"Halal Trade AI is under active investigation and carries a threat score of 20/100 on Crypto Kil)_ | 17/100 |

## /review/immediate-bienestar  (published; score 30 → 21; UNDER_INVESTIGATION)

| Wave | Field | From | To |
|---|---|---|---|
| A0 | `scam_score` | 30 | 21 |
| A1 | `title` | 30/100 | 21/100 |
| A2 | `meta_description` | 29/100 _(Immediate Bienestar holds a 29/100 threat score on Crypto Killer's watchlist. Active across {{)_ | 21/100 |
| A2 | `summary` | 29/100 _(Immediate Bienestar carries a 29/100 threat score and is on Crypto Killer's watchlist pending fu)_ | 21/100 |
| A1 | `full_article` | 30/100 | 21/100 |
| A1 | `full_article` | 30/100 | 21/100 |
| A1 | `full_article` | 30/100 | 21/100 |
| A1 | `full_article` | 30/100 | 21/100 |
| A1 | `full_article` | 30/100 | 21/100 |
| A1 | `full_article` | 30/100 | 21/100 |
| A1 | `full_article` | 30/100 | 21/100 |
| A1 | `full_article` | 30/100 | 21/100 |
| A1 | `full_article` | 30/100 | 21/100 |
| A1 | `full_article` | 30/100 | 21/100 |
| A1 | `full_article` | 30/100 | 21/100 |
| B | `full_article` | 14 countries | 15 countries |
| B | `full_article` | 14 countries | 15 countries |
| B | `full_article` | 14 countries | 15 countries |
| B | `full_article` | 14 countries | 15 countries |
| B | `full_article` | 14 countries | 15 countries |
| B | `full_article` | 14 countries | 15 countries |
| B | `full_article` | 14 countries | 15 countries |
| B | `full_article` | 14 countries | 15 countries |
| B | `full_article` | 14 countries | 15 countries |
| B | `full_article` | 14 countries | 15 countries |
| B | `full_article` | 14 countries | 15 countries |
| B | `full_article` | 55 public figures | 61 public figures |
| B | `full_article` | 55 public figures | 61 public figures |
| B | `full_article` | 55 public figures | 61 public figures |
| B | `full_article` | 55 celebrities | 61 celebrities |
| B | `full_article` | 55 public figures | 61 public figures |
| B | `full_article` | 55 public figures | 61 public figures |
| B | `full_article` | 173 ad creatives | 191 ad creatives |
| B | `full_article` | 173 ad creatives | 191 ad creatives |
| B | `red_flags[0].flag` | 55 public figures | 61 public figures |
| B | `red_flags[1].flag` | 14 countries | 15 countries |
| A2 | `faq[0].answer` | 29/100 _(Immediate Bienestar is under active investigation and carries a threat score of 29/100 on Crypto Killer's watc)_ | 21/100 |
| A2 | `schema_json` | 29/100 _("https://cryptokiller.org/review/immediate-bienestar","name":"Immediate Bienestar Review: 29/100 Threat Score )_ | 21/100 |
| A2 | `schema_json` | 29/100 _(iew/immediate-bienestar#cryptokiller-dataset"},"description":"Immediate Bienestar holds a 29/100 threat score )_ | 21/100 |
| A2 | `schema_json` | 29/100 _(ate Bienestar","@type":"SoftwareApplication","description":"Platform under investigation. 29/100 threat score )_ | 21/100 |
| A2 | `schema_json` | 29/100 _(zation"},"wordCount":2636,"inLanguage":"en-US","description":"Immediate Bienestar holds a 29/100 threat score )_ | 21/100 |
| A2 | `schema_json` | 29/100 _(reApplication","description":"Platform under investigation by Crypto Killer. Threat score 29/100."},"reviewRat)_ | 21/100 |
| A2 | `schema_json` | 29/100 _(:{"text":"Immediate Bienestar is under active investigation and carries a threat score of 29/100 on Crypto Kil)_ | 21/100 |

## /review/immediate-connect  (published; score 25 → 16; LIMITED_EVIDENCE)

| Wave | Field | From | To |
|---|---|---|---|
| A0 | `scam_score` | 25 | 16 |
| A1 | `title` | 25/100 | 16/100 |
| A2 | `meta_description` | 22/100 _(Immediate Connect scores 22/100 on CryptoKiller's threat index. 6 red flags found across 3)_ | 16/100 |
| A2 | `summary` | 22/100 _(Immediate Connect is on Crypto Killer's watchlist pending further investigation, scoring 22/100 on Crypto Kill)_ | 16/100 |
| A1 | `full_article` | 25/100 | 16/100 |
| A1 | `full_article` | 25/100 | 16/100 |
| A1 | `full_article` | 25/100 | 16/100 |
| A1 | `full_article` | 25/100 | 16/100 |
| A2 | `full_article` | 22/100 _(Ronaldo in IT"> Cristiano Ronaldo ⚠️ Threat Score 22/ 100 Watchlist Thr)_ | 16/100 |
| B | `full_article` | 3 countries | 4 countries |
| B | `full_article` | 3 jurisdictions | 4 jurisdictions |
| B | `full_article` | 3 countries | 4 countries |
| B | `full_article` | 3 countries | 4 countries |
| B | `full_article` | 3 countries | 4 countries |
| B | `full_article` | 3 countries | 4 countries |
| B | `full_article` | 12 celebrities | 15 celebrities |
| B | `full_article` | 12 Celebrities | 15 Celebrities |
| B | `full_article` | 83 ad creatives | 116 ad creatives |
| B | `full_article` | between Sep 10, 2025 and May 26, 2026 | between Sep 10, 2025 and Aug 13, 2026 |
| B | `full_article` | 258 days of continuous operation | 337 days of continuous operation |
| C2 | `full_article` | Do not deposit any money. _(g>Immediate Connect is under active investigation. Verify before depositing. Do not deposit any money. Based o)_ | Verify the platform’s regulatory status independently before depositing any money. |
| B | `information_gain_summary` | 83 creatives | 116 creatives |
| B | `red_flags[0].detail` | 3 jurisdictions | 4 jurisdictions |
| B | `red_flags[1].flag` | 12 Celebrities | 15 Celebrities |
| A2 | `schema_json` | 22/100 _(rl":"https://cryptokiller.org/review/immediate-connect","name":"Immediate Connect Review: 22/100 Threat Score )_ | 16/100 |
| A2 | `schema_json` | 22/100 _(mediate-connect#breadcrumb"},"inLanguage":"en-US","description":"Immediate Connect scores 22/100 on CryptoKill)_ | 16/100 |
| A2 | `schema_json` | 22/100 _(diate Connect","@type":"SoftwareApplication","description":"Platform under investigation. 22/100 threat score )_ | 16/100 |
| A2 | `schema_json` | 22/100 _(anization"},"wordCount":2151,"inLanguage":"en-US","description":"Immediate Connect scores 22/100 on CryptoKill)_ | 16/100 |
| A2 | `schema_json` | 22/100 _(reApplication","description":"Platform under investigation by Crypto Killer. Threat score 22/100."},"reviewRat)_ | 16/100 |

## /review/immediate-v4-intal  (published; score 33 → 24; UNDER_INVESTIGATION)

| Wave | Field | From | To |
|---|---|---|---|
| A0 | `scam_score` | 33 | 24 |
| A1 | `title` | 33/100 | 24/100 |
| B | `alternative_headline` | 9 Countries | 12 Countries |
| A2 | `meta_description` | 28/100 _(Immediate +V4 Intal scores 28/100 on Crypto Killer's threat index. 7 red flags identified acr)_ | 24/100 |
| B | `meta_description` | 9 countries | 12 countries |
| A2 | `summary` | 28/100 _(mmediate +V4 Intal is on Crypto Killer's watchlist pending further investigation, scoring 28/100 on Crypto Kil)_ | 24/100 |
| A1 | `full_article` | 33/100 | 24/100 |
| A1 | `full_article` | 33/100 | 24/100 |
| A1 | `full_article` | 33/100 | 24/100 |
| B | `full_article` | 9 countries | 12 countries |
| B | `full_article` | 9 countries | 12 countries |
| B | `full_article` | 9 countries | 12 countries |
| B | `full_article` | 9 countries | 12 countries |
| B | `full_article` | 45 celebrities | 56 celebrities |
| B | `full_article` | 152 ad creatives | 177 ad creatives |
| B | `full_article` | between Sep 16, 2025 and Apr 29, 2026 | between Sep 16, 2025 and Aug 13, 2026 |
| B | `full_article` | 225 days of continuous operation | 331 days of continuous operation |
| C2 | `full_article` | Do not deposit any money. _(rify before depositing. Do not deposit any money. <div style="border-top:1px solid rg)_ | Verify the platform’s regulatory status independently before depositing any money. |
| A2 | `schema_json` | 28/100 _(:"https://cryptokiller.org/review/immediate-v4-intal","name":"Immediate +V4 Intal Review: 28/100 Threat Score )_ | 24/100 |
| A2 | `schema_json` | 28/100 _(iate-v4-intal#breadcrumb"},"inLanguage":"en-US","description":"Immediate +V4 Intal scores 28/100 on Crypto Kil)_ | 24/100 |
| A2 | `schema_json` | 28/100 _(ate +V4 Intal","@type":"SoftwareApplication","description":"Platform under investigation. 28/100 threat score )_ | 24/100 |
| A2 | `schema_json` | 28/100 _(ization"},"wordCount":2294,"inLanguage":"en-US","description":"Immediate +V4 Intal scores 28/100 on Crypto Kil)_ | 24/100 |
| A2 | `schema_json` | 28/100 _(reApplication","description":"Platform under investigation by Crypto Killer. Threat score 28/100."},"reviewRat)_ | 24/100 |

## /review/investbot  (published; score 27 → 19; LIMITED_EVIDENCE)

| Wave | Field | From | To |
|---|---|---|---|
| A0 | `scam_score` | 27 | 19 |
| A1 | `title` | 27/100 | 19/100 |
| A2 | `meta_description` | 24/100 _(InvestBot scores 24/100 on CryptoKiller's threat index. 4 red flags identified acro)_ | 19/100 |
| A2 | `summary` | 24/100 _(InvestBot is on Crypto Killer's watchlist pending further investigation, scoring 24/100 on Crypto Killer's thr)_ | 19/100 |
| A1 | `full_article` | 27/100 | 19/100 |
| A1 | `full_article` | 27/100 | 19/100 |
| A1 | `full_article` | 27/100 | 19/100 |
| A1 | `full_article` | 27/100 | 19/100 |
| A2 | `full_article` | 24/100 _(days — campaign remains operational ⚠️ Threat Score 24/ 100 Watchlist Thr)_ | 19/100 |
| B | `full_article` | 100,87 ad creatives | 353 ad creatives |
| B | `full_article` | 87 ad creatives | 353 ad creatives |
| B | `full_article` | between Sep 9, 2025 and May 28, 2026 | between Sep 9, 2025 and Aug 13, 2026 |
| B | `full_article` | 261 days of continuous operation | 338 days of continuous operation |
| C2 | `full_article` | Do not deposit any money. _(p> InvestBot is under active investigation. Verify before depositing. Do not deposit any money. Based on analy)_ | Verify the platform’s regulatory status independently before depositing any money. |
| B | `expertise_depth` | 100,87 ad creatives | 353 ad creatives |
| A2 | `faq[0].answer` | 24/100 _(InvestBot exhibits red flags consistent with unauthorized trading platforms. It scores 24/100 on CryptoKiller')_ | 19/100 |
| A2 | `schema_json` | 24/100 _(tbot#webpage","url":"https://cryptokiller.org/review/investbot","name":"InvestBot Review: 24/100 Threat Score )_ | 19/100 |
| A2 | `schema_json` | 24/100 _(er.org/review/investbot#breadcrumb"},"inLanguage":"en-US","description":"InvestBot scores 24/100 on CryptoKill)_ | 19/100 |
| A2 | `schema_json` | 24/100 _(e":"InvestBot","@type":"SoftwareApplication","description":"Platform under investigation. 24/100 threat score )_ | 19/100 |
| A2 | `schema_json` | 24/100 _(org/#organization"},"wordCount":1778,"inLanguage":"en-US","description":"InvestBot scores 24/100 on CryptoKill)_ | 19/100 |
| A2 | `schema_json` | 24/100 _(reApplication","description":"Platform under investigation by Crypto Killer. Threat score 24/100."},"reviewRat)_ | 19/100 |
| A2 | `schema_json` | 24/100 _(":"InvestBot exhibits red flags consistent with unauthorized trading platforms. It scores 24/100 on CryptoKill)_ | 19/100 |

## /review/justo-credovia  (published; score 4 → 5; LIMITED_EVIDENCE)

| Wave | Field | From | To |
|---|---|---|---|
| A0 | `scam_score` | 4 | 5 |
| A2 | `meta_description` | 14/100 _(Justo Credovia scores 14/100 on Crypto Killer's threat index. Surveillance data flags {{)_ | 5/100 |
| A2 | `summary` | 14/100 _(Justo Credovia shows limited signals in current surveillance data, scoring 14/100 on Crypto Killer's threat in)_ | 5/100 |
| A1 | `full_article` | 4/100 | 5/100 |
| A1 | `full_article` | 4/100 | 5/100 |
| A1 | `full_article` | 4/100 | 5/100 |
| A1 | `full_article` | 4/100 | 5/100 |
| A1 | `full_article` | 4/100 | 5/100 |
| A1 | `full_article` | 4/100 | 5/100 |
| A1 | `full_article` | 4/100 | 5/100 |
| A1 | `full_article` | 4/100 | 5/100 |
| A1 | `full_article` | 4/100 | 5/100 |
| A1 | `full_article` | 4/100 | 5/100 |
| A1 | `full_article` | 4/100 | 5/100 |
| B | `full_article` | 58 days of operation | 97 days of operation |
| A2 | `not_for_you` | 14/100 _(y. Here is the line a competitor will not print: our current data shows a threat score of 14/100, and Justo Cr)_ | 5/100 |
| A2 | `information_gain_summary` | 14/100 _(This review publishes low-signal surveillance data — a 14/100 threat score, a captured ad-creative count, sing)_ | 5/100 |
| A2 | `key_takeaways[0]` | 14/100 _(Threat score is 14/100 — low tier, but active surveillance continues as velocity i)_ | 5/100 |
| A2 | `faq[0].answer` | 14/100 _(Justo Credovia has a threat score of 14/100 in current surveillance data, which shows limited signals a)_ | 5/100 |
| A2 | `schema_json` | 14/100 _(iew/justo-credovia#breadcrumb"},"inLanguage":"en-US","description":"Justo Credovia scores 14/100 on Crypto Kil)_ | 5/100 |
| A2 | `schema_json` | 14/100 _(ame":"Justo Credovia","@type":"Organization","description":"Platform under investigation. 14/100 threat score )_ | 5/100 |
| A2 | `schema_json` | 14/100 _(organization"},"wordCount":2431,"inLanguage":"en-US","description":"Justo Credovia scores 14/100 on Crypto Kil)_ | 5/100 |
| A2 | `schema_json` | 14/100 _("Organization","description":"Platform under investigation by Crypto Killer. Threat score 14/100."},"datePubli)_ | 5/100 |
| A2 | `schema_json` | 14/100 _(scam?","@type":"Question","acceptedAnswer":{"text":"Justo Credovia has a threat score of 14/100 in current sur)_ | 5/100 |

## /review/kaspi-ai  (published; score 18 → 9; LIMITED_EVIDENCE)

| Wave | Field | From | To |
|---|---|---|---|
| A0 | `scam_score` | 18 | 9 |
| A1 | `meta_description` | 18/100 | 9/100 |
| A1 | `summary` | 18/100 | 9/100 |
| A1 | `full_article` | 18/100 | 9/100 |
| A1 | `full_article` | 18/100 | 9/100 |
| A1 | `full_article` | 18/100 | 9/100 |
| A1 | `full_article` | 18/100 | 9/100 |
| A1 | `full_article` | 18/100 | 9/100 |
| A1 | `full_article` | 18/100 | 9/100 |
| A1 | `full_article` | 18/100 | 9/100 |
| A1 | `full_article` | 18/100 | 9/100 |
| B | `full_article` | 8 celebrities | 9 celebrities |
| B | `full_article` | 136 ad creatives | 175 ad creatives |
| B | `full_article` | 136 ad creatives | 175 ad creatives |
| B | `full_article` | 171 days of continuous operation | 197 days of continuous operation |
| C1 | `full_article` | is a fraudulent operation _(> Frequently Asked Questions Is Kaspi AI legitimate? No. Kaspi AI is a fraudulent operation that impersonates )_ | displays the hallmarks of a fraudulent operation |
| A1 | `key_takeaways[0]` | 18/100 | 9/100 |
| A1 | `faq[0].answer` | 18/100 | 9/100 |
| A1 | `schema_json` | 18/100 | 9/100 |
| A1 | `schema_json` | 18/100 | 9/100 |
| A1 | `schema_json` | 18/100 | 9/100 |
| A1 | `schema_json` | 18/100 | 9/100 |
| A1 | `schema_json` | 18/100 | 9/100 |

## /review/legacy-bitfundex  (published; score 43 → 38; UNDER_INVESTIGATION)

| Wave | Field | From | To |
|---|---|---|---|
| A0 | `scam_score` | 43 | 38 |
| A1 | `title` | 43/100 | 38/100 |
| A2 | `meta_description` | 39/100 _(Legacy Bitfundex scores 39/100 on Crypto Killer's threat index. Active across {{stat:count)_ | 38/100 |
| A2 | `summary` | 39/100 _(Legacy Bitfundex is on Crypto Killer's watchlist pending further investigation, scoring 39/100 on Crypto Kille)_ | 38/100 |
| A1 | `full_article` | 43/100 | 38/100 |
| A1 | `full_article` | 43/100 | 38/100 |
| A1 | `full_article` | 43/100 | 38/100 |
| A1 | `full_article` | 43/100 | 38/100 |
| A1 | `full_article` | 43/100 | 38/100 |
| A1 | `full_article` | 43/100 | 38/100 |
| A2 | `key_takeaways[5]` | 39/100 _(Threat score stands at 39/100 — a watchlist rating indicating meaningful red flags consis)_ | 38/100 |
| A2 | `faq[0].answer` | 39/100 _(Legacy Bitfundex is under active investigation and carries a threat score of 39/100 on Crypto Killer's watchli)_ | 38/100 |
| A2 | `schema_json` | 39/100 _("url":"https://cryptokiller.org/review/legacy-bitfundex","name":"Legacy Bitfundex Review: 39/100 Threat Score )_ | 38/100 |
| A2 | `schema_json` | 39/100 _(legacy-bitfundex#breadcrumb"},"inLanguage":"en-US","description":"Legacy Bitfundex scores 39/100 on Crypto Kil)_ | 38/100 |
| A2 | `schema_json` | 39/100 _(acy Bitfundex","@type":"SoftwareApplication","description":"Platform under investigation. 39/100 threat score )_ | 38/100 |
| A2 | `schema_json` | 39/100 _(ganization"},"wordCount":2633,"inLanguage":"en-US","description":"Legacy Bitfundex scores 39/100 on Crypto Kil)_ | 38/100 |
| A2 | `schema_json` | 39/100 _(reApplication","description":"Platform under investigation by Crypto Killer. Threat score 39/100."},"reviewRat)_ | 38/100 |
| A2 | `schema_json` | 39/100 _(er":{"text":"Legacy Bitfundex is under active investigation and carries a threat score of 39/100 on Crypto Kil)_ | 38/100 |

## /review/nezertronixpro  (published; score 24 → 26; UNDER_INVESTIGATION)

| Wave | Field | From | To |
|---|---|---|---|
| A0 | `scam_score` | 24 | 26 |
| A1 | `title` | 24/100 | 26/100 |
| A2 | `meta_description` | 32/100 _(NezertronixPro scores 32/100 on CryptoKiller's threat index. {{stat:ad_creatives}} ad cr)_ | 26/100 |
| A2 | `summary` | 32/100 _(NezertronixPro is on Crypto Killer's watchlist pending further investigation, scoring 32/100 on Crypto Killer')_ | 26/100 |
| A1 | `full_article` | 24/100 | 26/100 |
| A1 | `full_article` | 24/100 | 26/100 |
| A1 | `full_article` | 24/100 | 26/100 |
| A1 | `full_article` | 24/100 | 26/100 |
| A1 | `full_article` | 24/100 | 26/100 |
| A1 | `full_article` | 24/100 | 26/100 |
| A2 | `full_article` | 32/100 _(ernández in AR"> Alberto Fernández ⚠️ Threat Score 32/ 100 Watchlist Thr)_ | 26/100 |
| B | `full_article` | 25 countries | 26 countries |
| B | `full_article` | 25 jurisdictions | 26 jurisdictions |
| B | `full_article` | 25 countries | 26 countries |
| B | `full_article` | 25 countries | 26 countries |
| B | `full_article` | 25 countries | 26 countries |
| B | `full_article` | 25 countries | 26 countries |
| B | `full_article` | 53 celebrities | 70 celebrities |
| B | `full_article` | 53 celebrities | 70 celebrities |
| B | `full_article` | 83 ad creatives | 100 ad creatives |
| B | `full_article` | between Feb 25, 2026 and Jun 3, 2026 | between Feb 25, 2026 and Aug 13, 2026 |
| B | `full_article` | 97 days of continuous operation | 169 days of continuous operation |
| C2 | `full_article` | Do not deposit any money. _(rong>NezertronixPro is under active investigation. Verify before depositing. Do not deposit any money. Based o)_ | Verify the platform’s regulatory status independently before depositing any money. |
| B | `information_gain_summary` | 25 countries | 26 countries |
| A2 | `key_takeaways[0]` | 32/100 _(NezertronixPro scores 32/100 on CryptoKiller's threat index, placing it on the watchlist)_ | 26/100 |
| B | `red_flags[1].flag` | 53 celebrities | 70 celebrities |
| B | `red_flags[2].detail` | 25 jurisdictions | 26 jurisdictions |
| B | `red_flags[4].flag` | 25 countries | 26 countries |
| A2 | `faq[0].answer` | 32/100 _(NezertronixPro exhibits red flags consistent with scam patterns, scoring 32/100 on CryptoKiller's threat index)_ | 26/100 |
| A2 | `schema_json` | 32/100 _(ge","url":"https://cryptokiller.org/review/nezertronixpro","name":"NezertronixPro Review: 32/100 Threat Score )_ | 26/100 |
| A2 | `schema_json` | 32/100 _(iew/nezertronixpro#breadcrumb"},"inLanguage":"en-US","description":"NezertronixPro scores 32/100 on CryptoKill)_ | 26/100 |
| A2 | `schema_json` | 32/100 _(ezertronixPro","@type":"SoftwareApplication","description":"Platform under investigation. 32/100 threat score )_ | 26/100 |
| A2 | `schema_json` | 32/100 _(organization"},"wordCount":2086,"inLanguage":"en-US","description":"NezertronixPro scores 32/100 on CryptoKill)_ | 26/100 |
| A2 | `schema_json` | 32/100 _(reApplication","description":"Platform under investigation by Crypto Killer. Threat score 32/100."},"reviewRat)_ | 26/100 |
| A2 | `schema_json` | 32/100 _(Answer":{"text":"NezertronixPro exhibits red flags consistent with scam patterns, scoring 32/100 on CryptoKill)_ | 26/100 |

## /review/nordiqo  (published; score 30 → 21; UNDER_INVESTIGATION)

| Wave | Field | From | To |
|---|---|---|---|
| A0 | `scam_score` | 30 | 21 |
| A1 | `title` | 30/100 | 21/100 |
| B | `alternative_headline` | 240 Ad Creatives | 307 Ad Creatives |
| A2 | `meta_description` | 26/100 _(Nordiqo scores 26/100 on Crypto Killer's threat index. 240 ad creatives, 10 celeb)_ | 21/100 |
| B | `meta_description` | 10 celebrities | 11 celebrities |
| B | `meta_description` | 240 ad creatives | 307 ad creatives |
| A2 | `summary` | 26/100 _(Nordiqo is on Crypto Killer's watchlist pending further investigation, scoring 26/100 on Crypto Killer's threa)_ | 21/100 |
| A1 | `full_article` | 30/100 | 21/100 |
| A1 | `full_article` | 30/100 | 21/100 |
| A1 | `full_article` | 30/100 | 21/100 |
| A1 | `full_article` | 30/100 | 21/100 |
| B | `full_article` | 10 public figures | 11 public figures |
| B | `full_article` | 10 celebrities | 11 celebrities |
| B | `full_article` | 10 celebrities | 11 celebrities |
| B | `full_article` | 240 ad creatives | 307 ad creatives |
| B | `full_article` | between Sep 8, 2025 and May 1, 2026 | between Sep 8, 2025 and Aug 13, 2026 |
| B | `full_article` | 235 days of continuous operation | 339 days of continuous operation |
| C2 | `full_article` | Do not deposit any money. _(rify before depositing. Do not deposit any money. <div style="border-top:1px solid rg)_ | Verify the platform’s regulatory status independently before depositing any money. |
| B | `key_takeaways[1]` | 10 public figures | 11 public figures |
| B | `red_flags[2].flag` | 10 celebrities | 11 celebrities |
| A2 | `schema_json` | 26/100 _(/nordiqo#webpage","url":"https://cryptokiller.org/review/nordiqo","name":"Nordiqo Review: 26/100 Threat Score )_ | 21/100 |
| A2 | `schema_json` | 26/100 _(killer.org/review/nordiqo#breadcrumb"},"inLanguage":"en-US","description":"Nordiqo scores 26/100 on Crypto Kil)_ | 21/100 |
| A2 | `schema_json` | 26/100 _(ame":"Nordiqo","@type":"SoftwareApplication","description":"Platform under investigation. 26/100 threat score )_ | 21/100 |
| A2 | `schema_json` | 26/100 _(r.org/#organization"},"wordCount":1989,"inLanguage":"en-US","description":"Nordiqo scores 26/100 on Crypto Kil)_ | 21/100 |
| A2 | `schema_json` | 26/100 _(reApplication","description":"Platform under investigation by Crypto Killer. Threat score 26/100."},"reviewRat)_ | 21/100 |

## /review/peak-luxentria  (published; score 11 → 1; LIMITED_EVIDENCE)

| Wave | Field | From | To |
|---|---|---|---|
| A0 | `scam_score` | 11 | 1 |
| A1 | `meta_description` | 11/100 | 1/100 |
| A1 | `summary` | 11/100 | 1/100 |
| A1 | `full_article` | 11/100 | 1/100 |
| A1 | `full_article` | 11/100 | 1/100 |
| A1 | `full_article` | 11/100 | 1/100 |
| A1 | `full_article` | 11/100 | 1/100 |
| A1 | `full_article` | 11/100 | 1/100 |
| A1 | `full_article` | 11/100 | 1/100 |
| A1 | `full_article` | 11/100 | 1/100 |
| A1 | `full_article` | 11/100 | 1/100 |
| A1 | `full_article` | 11/100 | 1/100 |
| A1 | `not_for_you` | 11/100 | 1/100 |
| A1 | `key_takeaways[0]` | 11/100 | 1/100 |
| A1 | `faq[0].answer` | 11/100 | 1/100 |
| A1 | `schema_json` | 11/100 | 1/100 |
| A1 | `schema_json` | 11/100 | 1/100 |
| A1 | `schema_json` | 11/100 | 1/100 |
| A1 | `schema_json` | 11/100 | 1/100 |
| A1 | `schema_json` | 11/100 | 1/100 |

## /review/prestara-nexor  (published; score 8 → 8; LIMITED_EVIDENCE)

| Wave | Field | From | To |
|---|---|---|---|
| A2 | `meta_description` | 13/100 _(Prestara Nexor scores 13/100 on Crypto Killer's threat index. 5 red flags identified acr)_ | 8/100 |
| B | `meta_description` | 61 ad creatives | 111 ad creatives |
| A2 | `summary` | 13/100 _(Prestara Nexor shows limited signals in current surveillance data, scoring 13/100 on Crypto Killer's threat in)_ | 8/100 |
| B | `full_article` | 19 celebrities | 26 celebrities |
| B | `full_article` | 61 ad creatives | 111 ad creatives |
| B | `full_article` | between Apr 13, 2026 and Apr 30, 2026 | between Apr 13, 2026 and Aug 13, 2026 |
| B | `full_article` | 17 days of continuous operation | 122 days of continuous operation |
| C2 | `full_article` | Do not deposit any money. _(ls. Ongoing monitoring. Do not deposit any money. <div style="border-top:1px solid rg)_ | Verify the platform’s regulatory status independently before depositing any money. |
| B | `information_gain_summary` | 61 ad creatives | 111 ad creatives |
| A2 | `key_takeaways[0]` | 13/100 _(Prestara Nexor scores 13/100 on Crypto Killer's threat index, placing it in the low-sign)_ | 8/100 |
| A2 | `faq[0].answer` | 13/100 _(Prestara Nexor scores 13/100 on Crypto Killer's threat index, placing it in the low-sign)_ | 8/100 |

## /review/prestaranexor  (published; score 3 → 4; LIMITED_EVIDENCE)

| Wave | Field | From | To |
|---|---|---|---|
| A0 | `scam_score` | 3 | 4 |
| A1 | `title` | 3/100 | 4/100 |
| A2 | `meta_description` | 12/100 _(PrestaraNexor scores 12/100 on CryptoKiller's threat index. Surveillance detects {{stat)_ | 4/100 |
| A2 | `summary` | 12/100 _(PrestaraNexor shows limited signals in current surveillance data, scoring 12/100 on CryptoKiller's threat inde)_ | 4/100 |
| A1 | `full_article` | 3/100 | 4/100 |
| A1 | `full_article` | 3/100 | 4/100 |
| A1 | `full_article` | 3/100 | 4/100 |
| A1 | `full_article` | 3/100 | 4/100 |
| A1 | `full_article` | 3/100 | 4/100 |
| A1 | `full_article` | 3/100 | 4/100 |
| A1 | `full_article` | 3/100 | 4/100 |
| A1 | `full_article` | 3/100 | 4/100 |
| B | `full_article` | between Jun 4, 2026 and Jun 21, 2026 | between Jun 4, 2026 and Aug 13, 2026 |
| B | `full_article` | 17 days of continuous operation | 70 days of continuous operation |
| C2 | `full_article` | Do not deposit any money. _(ls. Ongoing monitoring. Do not deposit any money. <div style="border-top:1px solid rg)_ | Verify the platform’s regulatory status independently before depositing any money. |
| A2 | `not_for_you` | 12/100 _(Philippines; campaigns in other regions may differ. Note: PrestaraNexor currently scores 12/100 and shows limi)_ | 4/100 |
| A2 | `key_takeaways[0]` | 12/100 _(Threat score stands at 12/100 — placing PrestaraNexor in the Low Signal tier under curren)_ | 4/100 |
| A2 | `red_flags[5].detail` | 12/100 _(does not clear the platform; it reflects an early-stage footprint with a threat score of 12/100. The combinati)_ | 4/100 |
| A2 | `faq[0].answer` | 12/100 _(t the evidentiary threshold for a confirmed scam designation. Its current threat score is 12/100, and surveill)_ | 4/100 |
| A2 | `schema_json` | 12/100 _(page","url":"https://cryptokiller.org/review/prestaranexor","name":"PrestaraNexor Review: 12/100 Threat Score )_ | 4/100 |
| A2 | `schema_json` | 12/100 _(eview/prestaranexor#breadcrumb"},"inLanguage":"en-US","description":"PrestaraNexor scores 12/100 on CryptoKill)_ | 4/100 |
| A2 | `schema_json` | 12/100 _(name":"PrestaraNexor","@type":"Organization","description":"Platform under investigation. 12/100 threat score )_ | 4/100 |
| A2 | `schema_json` | 12/100 _(#organization"},"wordCount":2302,"inLanguage":"en-US","description":"PrestaraNexor scores 12/100 on CryptoKill)_ | 4/100 |
| A2 | `schema_json` | 12/100 _("Organization","description":"Platform under investigation by Crypto Killer. Threat score 12/100."},"datePubli)_ | 4/100 |
| A2 | `schema_json` | 12/100 _(t the evidentiary threshold for a confirmed scam designation. Its current threat score is 12/100, and surveill)_ | 4/100 |

## /review/primeaura  (published; score 55 → 46; ELEVATED_RISK)

| Wave | Field | From | To |
|---|---|---|---|
| A0 | `scam_score` | 55 | 46 |
| A1 | `title` | 55/100 | 46/100 |
| A2 | `meta_description` | 50/100 _(PrimeAura scores 50/100 on Crypto Killer's threat index. {{stat:ad_creatives}} ad c)_ | 46/100 |
| A2 | `summary` | 50/100 _(PrimeAura exhibits multiple serious red flags associated with investment fraud, scoring 50/100 on Crypto Kille)_ | 46/100 |
| A1 | `full_article` | 55/100 | 46/100 |
| A1 | `full_article` | 55/100 | 46/100 |
| A1 | `full_article` | 55/100 | 46/100 |
| B | `full_article` | 56 celebrities | 166 celebrities |
| B | `full_article` | 388 ad creatives | 474 ad creatives |
| A2 | `schema_json` | 50/100 _(aura#webpage","url":"https://cryptokiller.org/review/primeaura","name":"PrimeAura Review: 50/100 Threat Score )_ | 46/100 |
| A2 | `schema_json` | 50/100 _(er.org/review/primeaura#breadcrumb"},"inLanguage":"en-US","description":"PrimeAura scores 50/100 on Crypto Kil)_ | 46/100 |
| A2 | `schema_json` | 50/100 _(e":"PrimeAura","@type":"SoftwareApplication","description":"Platform under investigation. 50/100 threat score )_ | 46/100 |
| A2 | `schema_json` | 50/100 _(org/#organization"},"wordCount":2395,"inLanguage":"en-US","description":"PrimeAura scores 50/100 on Crypto Kil)_ | 46/100 |
| A2 | `schema_json` | 50/100 _(reApplication","description":"Platform under investigation by Crypto Killer. Threat score 50/100."},"reviewRat)_ | 46/100 |

## /review/quantum  (draft; score 38 → 29; UNDER_INVESTIGATION)

| Wave | Field | From | To |
|---|---|---|---|
| A0 | `scam_score` | 38 | 29 |
| A1 | `title` | 38/100 | 29/100 |
| A1 | `alternative_headline` | 38/100 | 29/100 |
| A1 | `meta_description` | 38/100 | 29/100 |
| A1 | `summary` | 38/100 | 29/100 |
| A1 | `full_article` | 38/100 | 29/100 |
| A1 | `full_article` | 38/100 | 29/100 |
| A1 | `full_article` | 38/100 | 29/100 |
| A1 | `full_article` | 38/100 | 29/100 |
| A1 | `full_article` | 38/100 | 29/100 |
| A1 | `full_article` | 38/100 | 29/100 |
| A1 | `full_article` | 38/100 | 29/100 |
| A1 | `full_article` | 38/100 | 29/100 |
| B | `full_article` | 406 ad creatives | 417 ad creatives |
| B | `full_article` | 406 ad creatives | 417 ad creatives |
| A1 | `key_takeaways[0]` | 38/100 | 29/100 |
| A1 | `red_flags[4].detail` | 38/100 | 29/100 |
| A1 | `faq[0].answer` | 38/100 | 29/100 |
| A1 | `schema_json` | 38/100 | 29/100 |
| A1 | `schema_json` | 38/100 | 29/100 |
| A1 | `schema_json` | 38/100 | 29/100 |
| A1 | `schema_json` | 38/100 | 29/100 |
| A1 | `schema_json` | 38/100 | 29/100 |
| A1 | `schema_json` | 38/100 | 29/100 |
| A1 | `schema_json` | 38/100 | 29/100 |

## /review/quantum-ai  (published; score 95 → 86; CONFIRMED)

| Wave | Field | From | To |
|---|---|---|---|
| D | `scam_brands.alternate_domains` | (empty) _(reviews.sources[2] + reviews.citations[0]; re-verified live 2026-08-31)_ | ["quantumai.co.com"] |
| D | `scam_brands.primary_domain` | (empty) _(reviews.sources[2] + reviews.citations[0]; re-verified live 2026-08-31)_ | "quantumai.co" |
| D | `scam_brands.regulators_checked` | (empty) _(reviews.sources[2] + reviews.citations[0]; re-verified live 2026-08-31)_ | [{"regulator":"FCA","jurisdiction":"GB","register_url":"https://register.fca.org.uk/","checked_at":" |
| D | `scam_brands.regulator_warnings` | (empty) _(reviews.sources[2] + reviews.citations[0]; re-verified live 2026-08-31)_ | [{"regulator":"FCA","jurisdiction":"GB","url":"https://www.fca.org.uk/news/warnings/quantum-ai","pub |
| A0 | `scam_score` | 95 | 86 |
| A1 | `title` | 95/100 | 86/100 |
| A1 | `meta_description` | 95/100 | 86/100 |
| A1 | `summary` | 95/100 | 86/100 |
| A1 | `full_article` | 95/100 | 86/100 |
| A1 | `full_article` | 95/100 | 86/100 |
| A1 | `full_article` | 95/100 | 86/100 |
| A1 | `full_article` | 95/100 | 86/100 |
| A1 | `full_article` | 95/100 | 86/100 |
| A1 | `full_article` | 95/100 | 86/100 |
| A1 | `full_article` | 95/100 | 86/100 |
| A1 | `full_article` | 95/100 | 86/100 |
| A1 | `full_article` | 95/100 | 86/100 |
| A1 | `full_article` | 95/100 | 86/100 |
| A1 | `full_article` | 95/100 | 86/100 |
| A1 | `full_article` | 95/100 | 86/100 |
| A1 | `key_takeaways[0]` | 95/100 | 86/100 |
| A1 | `faq[0].answer` | 95/100 | 86/100 |
| A1 | `schema_json` | 95/100 | 86/100 |
| A1 | `schema_json` | 95/100 | 86/100 |
| A1 | `schema_json` | 95/100 | 86/100 |
| A1 | `schema_json` | 95/100 | 86/100 |
| A1 | `schema_json` | 95/100 | 86/100 |
| A1 | `schema_json` | 95/100 | 86/100 |

## /review/quarix-ai  (published; score 7 → 8; LIMITED_EVIDENCE)

| Wave | Field | From | To |
|---|---|---|---|
| A0 | `scam_score` | 7 | 8 |
| A1 | `title` | 7/100 | 8/100 |
| A2 | `meta_description` | 4/100 _(Quarix AI scores 4/100 on Crypto Killer's threat index. {{stat:ad_creatives}} ad c)_ | 8/100 |
| A2 | `summary` | 4/100 _(Quarix AI shows limited signals in current surveillance data, scoring 4/100 on Crypto Killer's threat index. C)_ | 8/100 |
| A1 | `full_article` | 7/100 | 8/100 |
| A1 | `full_article` | 7/100 | 8/100 |
| A1 | `full_article` | 7/100 | 8/100 |
| A1 | `full_article` | 7/100 | 8/100 |
| A1 | `full_article` | 7/100 | 8/100 |
| A1 | `full_article` | 7/100 | 8/100 |
| A1 | `full_article` | 7/100 | 8/100 |
| A1 | `full_article` | 7/100 | 8/100 |
| A1 | `full_article` | 7/100 | 8/100 |
| C2 | `full_article` | Do not deposit any money. _(ls. Ongoing monitoring. Do not deposit any money. <div style="border-top:1px solid rg)_ | Verify the platform’s regulatory status independently before depositing any money. |
| A2 | `key_takeaways[0]` | 4/100 _(Quarix AI scored 4/100 on Crypto Killer's threat index, placing it in the low-sign)_ | 8/100 |
| A2 | `faq[0].answer` | 4/100 _(Quarix AI scores 4/100 on Crypto Killer's threat index, placing it in the low-sign)_ | 8/100 |
| A2 | `schema_json` | 4/100 _(x-ai#webpage","url":"https://cryptokiller.org/review/quarix-ai","name":"Quarix AI Review: 4/100 Threat Score [)_ | 8/100 |
| A2 | `schema_json` | 4/100 _(er.org/review/quarix-ai#breadcrumb"},"inLanguage":"en-US","description":"Quarix AI scores 4/100 on Crypto Kill)_ | 8/100 |
| A2 | `schema_json` | 4/100 _(e":"Quarix AI","@type":"SoftwareApplication","description":"Platform under investigation. 4/100 threat score ()_ | 8/100 |
| A2 | `schema_json` | 4/100 _(org/#organization"},"wordCount":1939,"inLanguage":"en-US","description":"Quarix AI scores 4/100 on Crypto Kill)_ | 8/100 |
| A2 | `schema_json` | 4/100 _(reApplication","description":"Platform under investigation by Crypto Killer. Threat score 4/100."},"datePublis)_ | 8/100 |
| A2 | `schema_json` | 4/100 _(ame":"Is Quarix AI a scam?","@type":"Question","acceptedAnswer":{"text":"Quarix AI scores 4/100 on Crypto Kill)_ | 8/100 |

## /review/senvix  (published; score 56 → 47; ELEVATED_RISK)

| Wave | Field | From | To |
|---|---|---|---|
| A0 | `scam_score` | 56 | 47 |
| A1 | `title` | 56/100 | 47/100 |
| B | `alternative_headline` | 17 Countries | 18 Countries |
| B | `alternative_headline` | 37 Public Figures | 107 Public Figures |
| A2 | `meta_description` | 50/100 _(Senvix scores 50/100 on Crypto Killer's threat index. CryptoKiller detected red)_ | 47/100 |
| B | `meta_description` | 17 countries | 18 countries |
| B | `meta_description` | 37 celebrities | 107 celebrities |
| A2 | `summary` | 50/100 _(Senvix exhibits multiple serious red flags associated with investment fraud, scoring 50/100 on Crypto Killer's)_ | 47/100 |
| A1 | `full_article` | 56/100 | 47/100 |
| A1 | `full_article` | 56/100 | 47/100 |
| A1 | `full_article` | 56/100 | 47/100 |
| A1 | `full_article` | 56/100 | 47/100 |
| B | `full_article` | 17 countries | 18 countries |
| B | `full_article` | 17 countries | 18 countries |
| B | `full_article` | 17 countries | 18 countries |
| B | `full_article` | 17 countries | 18 countries |
| B | `full_article` | 37 celebrities | 107 celebrities |
| B | `full_article` | 1,107 ad creatives | 1,278 ad creatives |
| B | `full_article` | between Sep 9, 2025 and Apr 29, 2026 | between Sep 9, 2025 and Aug 13, 2026 |
| B | `full_article` | 232 days of continuous operation | 338 days of continuous operation |
| A2 | `faq[0].answer` | 50/100 _(Senvix scores 50/100 on Crypto Killer's threat index and exhibits red flags cons)_ | 47/100 |
| A2 | `schema_json` | 50/100 _(iew/senvix#webpage","url":"https://cryptokiller.org/review/senvix","name":"Senvix Review: 50/100 Threat Score )_ | 47/100 |
| A2 | `schema_json` | 50/100 _(tokiller.org/review/senvix#breadcrumb"},"inLanguage":"en-US","description":"Senvix scores 50/100 on Crypto Kil)_ | 47/100 |
| A2 | `schema_json` | 50/100 _(name":"Senvix","@type":"SoftwareApplication","description":"Platform under investigation. 50/100 threat score )_ | 47/100 |
| A2 | `schema_json` | 50/100 _(er.org/#organization"},"wordCount":2343,"inLanguage":"en-US","description":"Senvix scores 50/100 on Crypto Kil)_ | 47/100 |
| A2 | `schema_json` | 50/100 _(reApplication","description":"Platform under investigation by Crypto Killer. Threat score 50/100."},"reviewRat)_ | 47/100 |
| A2 | `schema_json` | 50/100 _(":[{"name":"Is Senvix a scam?","@type":"Question","acceptedAnswer":{"text":"Senvix scores 50/100 on Crypto Kil)_ | 47/100 |

## /review/thistle-gainmere  (published; score 11 → 1; LIMITED_EVIDENCE)

| Wave | Field | From | To |
|---|---|---|---|
| A0 | `scam_score` | 11 | 1 |
| A1 | `alternative_headline` | 11/100 | 1/100 |
| A1 | `meta_description` | 11/100 | 1/100 |
| A1 | `summary` | 11/100 | 1/100 |
| A1 | `how_it_works` | 11/100 | 1/100 |
| A1 | `full_article` | 11/100 | 1/100 |
| A1 | `full_article` | 11/100 | 1/100 |
| A1 | `full_article` | 11/100 | 1/100 |
| A1 | `full_article` | 11/100 | 1/100 |
| A1 | `full_article` | 11/100 | 1/100 |
| A1 | `full_article` | 11/100 | 1/100 |
| A1 | `full_article` | 11/100 | 1/100 |
| A1 | `full_article` | 11/100 | 1/100 |
| A1 | `full_article` | 11/100 | 1/100 |
| A1 | `not_for_you` | 11/100 | 1/100 |
| A1 | `key_takeaways[0]` | 11/100 | 1/100 |
| A1 | `red_flags[6].detail` | 11/100 | 1/100 |
| A1 | `faq[0].answer` | 11/100 | 1/100 |
| A1 | `schema_json` | 11/100 | 1/100 |
| A1 | `schema_json` | 11/100 | 1/100 |
| A1 | `schema_json` | 11/100 | 1/100 |
| A1 | `schema_json` | 11/100 | 1/100 |
| A1 | `schema_json` | 11/100 | 1/100 |
| A1 | `schema_json` | 11/100 | 1/100 |

## /review/trade-vector-ai  (published; score 48 → 42; ELEVATED_RISK)

| Wave | Field | From | To |
|---|---|---|---|
| A0 | `scam_score` | 48 | 42 |
| A1 | `title` | 48/100 | 42/100 |
| A2 | `meta_description` | 41/100 _(Trade Vector AI scores 41/100 on Crypto Killer's threat index. {{stat:ad_creatives}} ad c)_ | 42/100 |
| A2 | `summary` | 41/100 _(e Vector AI exhibits multiple serious red flags associated with investment fraud, scoring 41/100 on Crypto Kil)_ | 42/100 |
| A1 | `full_article` | 48/100 | 42/100 |
| A1 | `full_article` | 48/100 | 42/100 |
| A1 | `full_article` | 48/100 | 42/100 |
| A1 | `full_article` | 48/100 | 42/100 |
| A1 | `full_article` | 48/100 | 42/100 |
| A1 | `full_article` | 48/100 | 42/100 |
| A1 | `full_article` | 48/100 | 42/100 |
| B | `full_article` | 20 countries | 24 countries |
| B | `full_article` | 20 Countries | 24 Countries |
| B | `full_article` | 20 countries | 24 countries |
| B | `full_article` | 20 countries | 24 countries |
| B | `full_article` | 20 countries | 24 countries |
| B | `full_article` | 65 celebrities | 136 celebrities |
| B | `full_article` | 65 Celebrities | 136 Celebrities |
| B | `full_article` | 453 ad creatives | 596 ad creatives |
| B | `full_article` | between Sep 9, 2025 and Apr 30, 2026 | between Sep 9, 2025 and Aug 13, 2026 |
| B | `full_article` | 233 days of continuous operation | 338 days of continuous operation |
| B | `red_flags[1].flag` | 65 Celebrities | 136 Celebrities |
| B | `red_flags[5].flag` | 20 Countries | 24 Countries |
| A2 | `faq[0].answer` | 41/100 _(Trade Vector AI appears on the FCA's Warning List as an unauthorized firm and scores 41/100 on Crypto Killer's)_ | 42/100 |
| A2 | `schema_json` | 41/100 _(","url":"https://cryptokiller.org/review/trade-vector-ai","name":"Trade Vector AI Review: 41/100 Threat Score )_ | 42/100 |
| A2 | `schema_json` | 41/100 _(w/trade-vector-ai#breadcrumb"},"inLanguage":"en-US","description":"Trade Vector AI scores 41/100 on Crypto Kil)_ | 42/100 |
| A2 | `schema_json` | 41/100 _(ade Vector AI","@type":"SoftwareApplication","description":"Platform under investigation. 41/100 threat score )_ | 42/100 |
| A2 | `schema_json` | 41/100 _(rganization"},"wordCount":2203,"inLanguage":"en-US","description":"Trade Vector AI scores 41/100 on Crypto Kil)_ | 42/100 |
| A2 | `schema_json` | 41/100 _(reApplication","description":"Platform under investigation by Crypto Killer. Threat score 41/100."},"reviewRat)_ | 42/100 |
| A2 | `schema_json` | 41/100 _(xt":"Trade Vector AI appears on the FCA's Warning List as an unauthorized firm and scores 41/100 on Crypto Kil)_ | 42/100 |

## /review/tradegpt  (published; score 30 → 21; UNDER_INVESTIGATION)

| Wave | Field | From | To |
|---|---|---|---|
| A0 | `scam_score` | 30 | 21 |
| A2 | `meta_description` | 29/100 _(TradeGPT scores 29/100 on Crypto Killer's threat index. Active across {{stat:count)_ | 21/100 |
| A2 | `summary` | 29/100 _(TradeGPT is on Crypto Killer's watchlist pending further investigation, scoring 29/100 on Crypto Killer's thre)_ | 21/100 |
| A1 | `full_article` | 30/100 | 21/100 |
| A1 | `full_article` | 30/100 | 21/100 |
| A1 | `full_article` | 30/100 | 21/100 |
| A1 | `full_article` | 30/100 | 21/100 |
| A1 | `full_article` | 30/100 | 21/100 |
| A1 | `full_article` | 30/100 | 21/100 |
| A1 | `full_article` | 30/100 | 21/100 |
| A1 | `full_article` | 30/100 | 21/100 |
| A1 | `full_article` | 30/100 | 21/100 |
| A1 | `full_article` | 30/100 | 21/100 |
| B | `full_article` | 15 countries | 17 countries |
| B | `full_article` | 15 countries | 17 countries |
| B | `full_article` | 15 countries | 17 countries |
| B | `full_article` | 15 countries | 17 countries |
| B | `full_article` | 15 countries | 17 countries |
| B | `full_article` | 15 countries | 17 countries |
| B | `full_article` | 15 countries | 17 countries |
| B | `full_article` | 15 countries | 17 countries |
| B | `full_article` | 15 countries | 17 countries |
| B | `full_article` | 15 countries | 17 countries |
| B | `full_article` | 15 countries | 17 countries |
| B | `full_article` | 13 public figures | 14 public figures |
| B | `full_article` | 13 celebrities | 14 celebrities |
| B | `full_article` | 13 public figures | 14 public figures |
| B | `full_article` | 77 ad creatives | 90 ad creatives |
| B | `full_article` | 77 ad creatives | 90 ad creatives |
| B | `full_article` | 310 days of operation | 338 days of operation |
| B | `full_article` | 310 days of continuous operation | 338 days of continuous operation |
| C1 | `full_article` | is a confirmed investment scam _(further verification before any deposit. ⚠️ Key Takeaways TradeGPT is a confirmed investment scam operating ac)_ | is a suspected investment scam |
| C1 | `full_article` | is a confirmed investment scam _(:700;color:#f87171;margin:0 0 16px;display:flex;align-items:center;gap:8px">⚠️ Key Takeaways TradeGPT is a con)_ | is a suspected investment scam |
| C1 | `full_article` | is a confirmed investment scam _(293b;padding-bottom:12px"> 📄 Investigation Summary TradeGPT is a confirmed investment scam targeting cryptocu)_ | is a suspected investment scam |
| A2 | `key_takeaways[0]` | 29/100 _(TradeGPT scores 29/100 on Crypto Killer's threat index, placing it in the Watchlis)_ | 21/100 |
| B | `red_flags[2].flag` | 13 public figures | 14 public figures |
| B | `red_flags[3].flag` | 15 countries | 17 countries |
| A2 | `faq[0].answer` | 29/100 _(oviding financial services without permission. Crypto Killer assigns it a threat score of 29/100. Verify indep)_ | 21/100 |
| A2 | `schema_json` | 29/100 _(://cryptokiller.org/review/tradegpt#cryptokiller-dataset"},"description":"TradeGPT scores 29/100 on Crypto Kil)_ | 21/100 |
| A2 | `schema_json` | 29/100 _(me":"TradeGPT","@type":"SoftwareApplication","description":"Platform under investigation. 29/100 threat score )_ | 21/100 |
| A2 | `schema_json` | 29/100 _(.org/#organization"},"wordCount":2621,"inLanguage":"en-US","description":"TradeGPT scores 29/100 on Crypto Kil)_ | 21/100 |
| A2 | `schema_json` | 29/100 _(reApplication","description":"Platform under investigation by Crypto Killer. Threat score 29/100."},"reviewRat)_ | 21/100 |
| A2 | `schema_json` | 29/100 _(oviding financial services without permission. Crypto Killer assigns it a threat score of 29/100. Verify indep)_ | 21/100 |

## /review/visi-n-luxovel  (published; score 4 → 5; LIMITED_EVIDENCE)

| Wave | Field | From | To |
|---|---|---|---|
| A0 | `scam_score` | 4 | 5 |
| A1 | `title` | 4/100 | 5/100 |
| A2 | `meta_description` | 12/100 _(Visión Luxovel scores 12/100 on Crypto Killer's threat index. 9 celebrities impersonated)_ | 5/100 |
| B | `meta_description` | 9 celebrities | 11 celebrities |
| B | `meta_description` | 27 ad creatives | 36 ad creatives |
| A2 | `summary` | 12/100 _(Visión Luxovel shows limited signals in current surveillance data, scoring 12/100 on Crypto Killer's threat in)_ | 5/100 |
| A1 | `full_article` | 4/100 | 5/100 |
| A1 | `full_article` | 4/100 | 5/100 |
| A1 | `full_article` | 4/100 | 5/100 |
| A1 | `full_article` | 4/100 | 5/100 |
| A1 | `full_article` | 4/100 | 5/100 |
| A1 | `full_article` | 4/100 | 5/100 |
| A1 | `full_article` | 4/100 | 5/100 |
| A1 | `full_article` | 4/100 | 5/100 |
| A2 | `full_article` | 12/100 _(os in ES"> José Elías, Pablo Motos ⚠️ Threat Score 12/ 100 Low Signal Th)_ | 5/100 |
| B | `full_article` | 9 celebrities | 11 celebrities |
| B | `full_article` | 27 ad creatives | 36 ad creatives |
| B | `full_article` | between May 13, 2026 and May 18, 2026 | between May 13, 2026 and Aug 13, 2026 |
| B | `full_article` | 5 days of continuous operation | 92 days of continuous operation |
| C2 | `full_article` | Do not deposit any money. _(ong> Visión Luxovel shows limited signals. Ongoing monitoring. Do not deposit any money. Based on analysis of )_ | Verify the platform’s regulatory status independently before depositing any money. |
| A2 | `key_takeaways[0]` | 12/100 _(Visión Luxovel scores 12/100 on Crypto Killer's threat index, placing it on the watchlis)_ | 5/100 |
| A2 | `faq[0].answer` | 12/100 _(Visión Luxovel scores 12/100 on Crypto Killer's threat index, indicating limited but not)_ | 5/100 |
| A2 | `schema_json` | 12/100 _(ge","url":"https://cryptokiller.org/review/visi-n-luxovel","name":"Visión Luxovel Review: 12/100 Threat Score )_ | 5/100 |
| A2 | `schema_json` | 12/100 _(iew/visi-n-luxovel#breadcrumb"},"inLanguage":"en-US","description":"Visión Luxovel scores 12/100 on Crypto Kil)_ | 5/100 |
| A2 | `schema_json` | 12/100 _(t":[{"name":"Visión Luxovel","@type":"Thing","description":"Platform under investigation. 12/100 threat score )_ | 5/100 |
| A2 | `schema_json` | 12/100 _(organization"},"wordCount":2079,"inLanguage":"en-US","description":"Visión Luxovel scores 12/100 on Crypto Kil)_ | 5/100 |
| A2 | `schema_json` | 12/100 _(@type":"Thing","description":"Platform under investigation by Crypto Killer. Threat score 12/100."},"datePubli)_ | 5/100 |
| A2 | `schema_json` | 12/100 _(isión Luxovel a scam?","@type":"Question","acceptedAnswer":{"text":"Visión Luxovel scores 12/100 on Crypto Kil)_ | 5/100 |

## /review/vlna-kapitisk  (published; score 2 → 2; LIMITED_EVIDENCE)

| Wave | Field | From | To |
|---|---|---|---|
| A2 | `meta_description` | 11/100 _(Vlna Kapitisk carries an 11/100 threat score. Surveillance data shows {{stat:ad_creatives}})_ | 2/100 |
| A2 | `summary` | 11/100 _(Vlna Kapitisk carries an 11/100 threat score — current surveillance data shows limited sign)_ | 2/100 |
| A2 | `how_it_works` | 11/100 _(ication loops, and minimum-withdrawal thresholds. Vlna Kapitisk carries a threat score of 11/100 and does not )_ | 2/100 |
| B | `full_article` | 3 days of continuous operation | 41 days of continuous operation |
| A2 | `key_takeaways[0]` | 11/100 _(Threat score is 11/100 — low signal, not a confirmed scam designation.)_ | 2/100 |
| A2 | `red_flags[6].detail` | 11/100 _(Vlna Kapitisk holds a threat score of 11/100 while remaining active as of {{stat:last_active}}. The low)_ | 2/100 |
| A2 | `faq[0].answer` | 11/100 _(am designation, but it shows red flags consistent with scam patterns. Its threat score is 11/100, it has been )_ | 2/100 |

## /review/whatsapp-ai  (published; score 35 → 28; UNDER_INVESTIGATION)

| Wave | Field | From | To |
|---|---|---|---|
| A0 | `scam_score` | 35 | 28 |
| A1 | `title` | 35/100 | 28/100 |
| A2 | `meta_description` | 30/100 _(WhatsApp AI scores 30/100 on Crypto Killer's threat index. {{stat:ad_creatives}} ad c)_ | 28/100 |
| A2 | `summary` | 30/100 _(WhatsApp AI is on Crypto Killer's watchlist pending further investigation, scoring 30/100 on Crypto Killer's t)_ | 28/100 |
| A1 | `full_article` | 35/100 | 28/100 |
| A1 | `full_article` | 35/100 | 28/100 |
| A1 | `full_article` | 35/100 | 28/100 |
| A1 | `full_article` | 35/100 | 28/100 |
| A1 | `full_article` | 35/100 | 28/100 |
| A2 | `full_article` | 30/100 _(к Цукерберг in LT"> Марк Цукерберг ⚠️ Threat Score 30/ 100 Watchlist Thr)_ | 28/100 |
| B | `full_article` | 13 countries | 20 countries |
| B | `full_article` | 13 jurisdictions | 20 jurisdictions |
| B | `full_article` | 13 countries | 20 countries |
| B | `full_article` | 13 countries | 20 countries |
| B | `full_article` | 13 countries | 20 countries |
| B | `full_article` | 16 celebrities | 22 celebrities |
| B | `full_article` | 387 ad creatives | 503 ad creatives |
| B | `full_article` | between Sep 15, 2025 and May 15, 2026 | between Sep 15, 2025 and Aug 13, 2026 |
| B | `full_article` | 242 days of continuous operation | 332 days of continuous operation |
| C2 | `full_article` | Do not deposit any money. _(WhatsApp AI is under active investigation. Verify before depositing. Do not deposit any money. Based on analys)_ | Verify the platform’s regulatory status independently before depositing any money. |
| B | `red_flags[2].detail` | 13 jurisdictions | 20 jurisdictions |
| A2 | `faq[0].answer` | 30/100 _(WhatsApp AI appears on Crypto Killer's watchlist with a 30/100 threat score. It holds no financial regulatory )_ | 28/100 |
| A2 | `schema_json` | 30/100 _(#webpage","url":"https://cryptokiller.org/review/whatsapp-ai","name":"WhatsApp AI Review: 30/100 Threat Score )_ | 28/100 |
| A2 | `schema_json` | 30/100 _(rg/review/whatsapp-ai#breadcrumb"},"inLanguage":"en-US","description":"WhatsApp AI scores 30/100 on Crypto Kil)_ | 28/100 |
| A2 | `schema_json` | 30/100 _(:"WhatsApp AI","@type":"SoftwareApplication","description":"Platform under investigation. 30/100 threat score )_ | 28/100 |
| A2 | `schema_json` | 30/100 _(g/#organization"},"wordCount":2172,"inLanguage":"en-US","description":"WhatsApp AI scores 30/100 on Crypto Kil)_ | 28/100 |
| A2 | `schema_json` | 30/100 _(reApplication","description":"Platform under investigation by Crypto Killer. Threat score 30/100."},"reviewRat)_ | 28/100 |
| A2 | `schema_json` | 30/100 _(estion","acceptedAnswer":{"text":"WhatsApp AI appears on Crypto Killer's watchlist with a 30/100 threat score.)_ | 28/100 |

## /review/whatsapp-bot  (published; score 30 → 21; UNDER_INVESTIGATION)

| Wave | Field | From | To |
|---|---|---|---|
| A0 | `scam_score` | 30 | 21 |
| A1 | `title` | 30/100 | 21/100 |
| B | `alternative_headline` | 11 Countries | 13 Countries |
| A2 | `meta_description` | 26/100 _(WhatsApp Bot scores 26/100 on Crypto Killer's threat index. 4 red flags identified acr)_ | 21/100 |
| B | `meta_description` | 11 countries | 13 countries |
| A2 | `summary` | 26/100 _(WhatsApp Bot is on Crypto Killer's watchlist pending further investigation, scoring 26/100 on Crypto Killer's )_ | 21/100 |
| A1 | `full_article` | 30/100 | 21/100 |
| A1 | `full_article` | 30/100 | 21/100 |
| A1 | `full_article` | 30/100 | 21/100 |
| A1 | `full_article` | 30/100 | 21/100 |
| B | `full_article` | 11 countries | 13 countries |
| B | `full_article` | 11 countries | 13 countries |
| B | `full_article` | 11 countries | 13 countries |
| B | `full_article` | 11 countries | 13 countries |
| B | `full_article` | 236 ad creatives | 254 ad creatives |
| B | `full_article` | between Sep 9, 2025 and May 1, 2026 | between Sep 9, 2025 and Aug 13, 2026 |
| B | `full_article` | 234 days of continuous operation | 338 days of continuous operation |
| C2 | `full_article` | Do not deposit any money. _(rify before depositing. Do not deposit any money. <div style="border-top:1px solid rg)_ | Verify the platform’s regulatory status independently before depositing any money. |
| A2 | `faq[0].answer` | 26/100 _(WhatsApp Bot scores 26/100 on Crypto Killer's threat index and appears on our watchlis)_ | 21/100 |
| A2 | `schema_json` | 26/100 _(ebpage","url":"https://cryptokiller.org/review/whatsapp-bot","name":"WhatsApp Bot Review: 26/100 Threat Score )_ | 21/100 |
| A2 | `schema_json` | 26/100 _(/review/whatsapp-bot#breadcrumb"},"inLanguage":"en-US","description":"WhatsApp Bot scores 26/100 on Crypto Kil)_ | 21/100 |
| A2 | `schema_json` | 26/100 _("WhatsApp Bot","@type":"SoftwareApplication","description":"Platform under investigation. 26/100 threat score )_ | 21/100 |
| A2 | `schema_json` | 26/100 _(/#organization"},"wordCount":1937,"inLanguage":"en-US","description":"WhatsApp Bot scores 26/100 on Crypto Kil)_ | 21/100 |
| A2 | `schema_json` | 26/100 _(reApplication","description":"Platform under investigation by Crypto Killer. Threat score 26/100."},"reviewRat)_ | 21/100 |
| A2 | `schema_json` | 26/100 _(Is WhatsApp Bot a scam?","@type":"Question","acceptedAnswer":{"text":"WhatsApp Bot scores 26/100 on Crypto Kil)_ | 21/100 |
