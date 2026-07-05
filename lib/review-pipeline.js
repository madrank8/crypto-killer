/**
 * Review Pipeline — multi-agent writer for scam reviews (P0-2, skill audit).
 * Date: 2026-06-10
 *
 * Replaces the monolithic single-Opus-call review writer (~30 JSON fields,
 * 16k output tokens, 600s ceiling, JSON-salvage hacks that could silently
 * amputate truncated content) with a 5-stage pipeline mirroring the proven
 * article pipeline (lib/article-pipeline.js):
 *
 *   Stage A: Skeleton   (Sonnet)  title/headline/meta/summary/takeaways/
 *                                 verdict/keyword/persona — tier-critical copy
 *   Stage B: Core       (Opus ∥)  how_it_works + red_flags — the evidence body
 *   Stage C: Trust      (Opus ∥)  protection/not_for_you/methodology/
 *                                 expertise/experience_signals/disclaimer
 *   Stage D: FAQ        (Sonnet ∥) canonical + boolean + recovery + family
 *   Stage E: Schema     (Sonnet)  all 12 enrichment fields + internal links +
 *                                 self_check — consumes B+C+D prose so
 *                                 mention_slugs/claims match what was written
 *
 * B, C, D run in parallel after A. E runs last. Typical wall time ~90-150s
 * vs 360-540s monolithic, with no single call over ~4k output tokens.
 *
 * NO deterministic fallback stages. These are YMYL pages — a templated stub
 * accusing a brand of fraud is worse than a failed generation. A stage that
 * exhausts its model chain throws, and the route surfaces the error.
 *
 * Deterministic post-processing the monolith trusted the LLM for:
 *   - verify_tags_count counted by regex over assembled prose
 *   - sources[] derived from the verified ledger (never invented)
 *   - citations[] filtered to ledger URLs
 *   - quotes[] filtered to ledger-attributable citations
 *
 * Rollback: set REVIEW_WRITER_MODE=mono in Vercel env — the route keeps the
 * original single-call path intact.
 */

const { callModel, extractJSON, MODELS } = require('./ai-models')
const { ANTI_SLOP_PROMPT_BLOCK } = require('./content-lint')

// ─── Condensed shared blocks ──────────────────────────────────────────
// Same rules as lib/review-prompts.js contentWriterPrompt, tightened per
// stage (precedent: section-writer.js vs sharedTopicalWritingRules).
//
// Kill lists live in ONE place now (audit 2026-07-05, W4b):
// lib/content-lint.js ANTI_SLOP_PROMPT_BLOCK — the exact list the
// deterministic publish gate enforces. This file only appends the
// Koray writing rules on top.

const ANTI_SLOP = `${ANTI_SLOP_PROMPT_BLOCK}
KORAY RULES: declaration-first sentences (fact first, never a dependent clause). One idea per sentence. Exact numbers, never "numerous". Primary entity in subject position. No copula hiding ("serves as" → "is"). No passive voice hiding the actor. Vary sentence length; never 3+ consecutive sub-8-word sentences.`

const ICP_BLOCK = `═══ ICP AUDIENCE (4 segments) ═══
A) PRE-SCAM SEARCHER: saw an ad, Googled "[brand] scam" — needs instant confirmation.
B) MID-SCAM DOUBTER: deposited, withdrawal failed — needs validation + action.
C) POST-SCAM VICTIM: lost money, feeling shame — needs recovery steps.
D) CONCERNED FAMILY: searching for a loved one — needs shareable evidence.
TONE: Never mock. "Targeted" not "fell for." Validate suspicion. Address shame directly.`

const JSON_RULES = `OUTPUT FORMAT: Valid JSON only. All string values use \\n for line breaks (no literal newlines inside strings). Escape quotes with \\". No trailing commas. No markdown fences. No markdown bold/italic in any field — plain text. Output ONLY the JSON object.`

function buildStatBlock(brandData, longevityDays, derivedCelebCount) {
  return `═══ STAT-TOKEN PROTOCOL (live numbers — NEVER bake literals) ═══
The renderer substitutes {{stat:KEY}} tokens with live scraper values on every render. Emit tokens for these six stats wherever they appear in prose — NEVER the literal number:
  Total ad creatives        → {{stat:ad_creatives}}        (write-time ≈ ${brandData.total_creatives})
  Countries targeted        → {{stat:countries_targeted}}  (≈ ${brandData.total_geos})
  Days active               → {{stat:days_active}}          (≈ ${longevityDays})
  Celebrities impersonated  → {{stat:celebrities_abused}}  (≈ ${derivedCelebCount})
  Weekly velocity (7-day)   → {{stat:weekly_velocity}}      (≈ ${brandData.velocity_7d})
  First detected            → {{stat:first_detected}} (long) / {{stat:first_detected|iso}}
  Last active               → {{stat:last_active}} (long) / {{stat:last_active|iso}}
Format modifiers: |raw (2909), |short (2.9k), default locale-formatted (2,909).
EMIT LITERALS for static facts: threat score (${brandData.scam_score}/100), regulator counts, dollar amounts from sources, years in citations.
PLURALIZATION: use plural-safe phrasing around tokens ("across {{stat:countries_targeted}} countries", "active for {{stat:days_active}} days"). For literal numbers match noun number ("1 country", never "1 countries").

═══ FORBIDDEN: INVENTED NUMBERS (hard-fails the publish audit) ═══
NEVER state a specific number that is not one of: (a) a {{stat:KEY}} token above,
(b) a literal from the INTELLIGENCE DATA / SOURCE LEDGER, or (c) a figure cited
from a named source. In particular:
- Do NOT cite the count of creative SAMPLES shown to you in this prompt (e.g.
  "8 sampled ads", "all 8 creatives"). The samples are an ILLUSTRATIVE SUBSET,
  not a finding. The real creative volume is {{stat:ad_creatives}}. Refer to
  examples qualitatively ("the sampled creatives", "several captured ads") with
  NO count.
- Do NOT invent platform-scale stats about CryptoKiller (e.g. "500+ campaigns
  catalogued", "we track 10,000+ brands"). If you don't have a real figure or
  token, describe the capability without a number.
- Do NOT invent financial specifics (e.g. "60-day chargeback window", "a 2%
  recovery fee") unless they come from a named source — chargeback windows vary
  by card network and jurisdiction, so write "contact your bank promptly, as
  chargeback windows are time-limited" without a fabricated number.`
}

function buildTierBlock(brandData, threat) {
  const base = `═══ THREAT CLASSIFICATION (OVERRIDES PROSE FRAMING) ═══
Brand: ${brandData.name}
Entity type: ${brandData.entity_type || 'unknown — default to generic investment/trading platform language; verify from evidence'}
Raw score: ${brandData.scam_score}/100 | Tier: ${threat.tier.toUpperCase()} | Label: ${threat.label}
Default prose frame: "${brandData.name} ${threat.prose}"
Frame as confirmed scam? ${threat.frameAsScam ? 'YES — declarative scam language allowed.' : 'NO — HEDGED investigative language ONLY.'}`

  if (threat.frameAsScam) return base

  return `${base}

═══ HARD CONSTRAINTS FOR THIS TIER ═══
BANNED in any user-visible field (sync pipeline REJECTS violations):
  - "Confirmed [X] Scam", "is a scam" (without hedge), "is a confirmed scam",
    "is a fraudulent [X]", "Avoid All Contact", "Do Not Deposit"
ALLOWED hedged phrasing:
  - "shows red flags consistent with scam patterns", "is a suspected [X] scam",
    "appears to be a scam", "warrants caution / further verification",
    "has not met the evidentiary threshold for a scam designation"
Style: investigative, not accusatory — Reuters/FT investigations desk. Describe evidence and its implications; do not render a verdict of guilt. Verdict template (paraphrase allowed, preserve hedging): "${brandData.name} ${threat.verdictOpener}."`
}

function buildEntityTypeBlock(brandData) {
  if (!brandData.entity_type || brandData.entity_type === 'Product' || brandData.entity_type === 'SoftwareApplication') return ''
  return `═══ ENTITY TYPE NOTE ═══
This brand is classified as "${brandData.entity_type}" — NOT necessarily a crypto trading platform. Tailor all language (funnel stages, regulators, victim actions) to the actual entity type. If the crypto-funnel template doesn't fit, rename the stages to match the real funnel (e.g. rental: Bait Listing → Deposit Demand → Fake Contract → Ghost).`
}

function buildCelebBlock(effectiveCelebList, derivedCelebCount, brandData) {
  return `═══ CELEBRITY REFERENCE HARD CONSTRAINT ═══
CELEBRITY NAMES (deduped canonical list — EXACT spellings only): ${effectiveCelebList.join(', ') || 'None detected'}
- ONLY reference names from this list. Empty list → generic phrasing ("public figures") with NO specific names.
- Every celebrity count in prose MUST be the token {{stat:celebrities_abused}} (write-time value: ${derivedCelebCount}). Never use ${brandData.total_celebrities} (raw pre-dedupe count).
- CJK names: original script OR the exact romanization in the list — never invent alternates.
HARD REJECTION at audit: any name not in this list.`
}

function buildLedgerBlock(sourceLedger, brandData) {
  const lines = (sourceLedger || [])
    .map((s, i) => `${i + 1}. [${s.type}]${s.generic ? ' [GENERIC]' : ''} ${s.title} — ${s.url}${s.extract ? `\n   Extract: "${s.extract}"` : ''}`)
    .join('\n')
  const genericRule = (sourceLedger || []).some((s) => s.generic)
    ? `\nGENERIC-SOURCE RULE: [GENERIC] entries are site-wide reporting resources, NOT brand-specific evidence. Cite ONLY in protection_steps — never as evidence that ${brandData.name} specifically was flagged.`
    : ''
  return `═══ VERIFIED SOURCE LEDGER (URL-verified pre-write — use these, never invent URLs) ═══\n${lines || '(empty)'}${genericRule}`
}

const FCA_BLOCK = `═══ FCA TWO-LIST DISTINCTION ═══
(1) Financial Services Register = AUTHORIZED firms → "does not appear on the FCA's Financial Services Register" (= unregistered).
(2) Warning List = firms flagged as operating WITHOUT permission → "the FCA has added [X] to its Warning List".
NEVER "does not appear on the FCA Warning List of authorized firms" — category error. Same distinction for SEC EDGAR vs SEC alerts, ASIC register vs ASIC warnings.`

function buildIntelligenceBlock(brandData, longevityDays, derivedCelebCount, creativeSample) {
  const samples = (creativeSample || []).slice(0, 8)
    .map((c, i) => `${i + 1}. "${c.offer_name || c.normalized_offer}" | Geo: ${c.geo || 'N/A'} | Celebrity: ${c.celebrity_name || 'None'} | Video: ${c.is_video ? 'Yes' : 'No'}`)
    .join('\n')
  return `INTELLIGENCE DATA (emit live stats as tokens, NOT literals):
- Threat Score (LITERAL): ${brandData.scam_score}/100
- Ad Creatives (TOKEN {{stat:ad_creatives}}): ${brandData.total_creatives}
- Countries (TOKEN {{stat:countries_targeted}}): ${brandData.total_geos}
- Celebrities (TOKEN {{stat:celebrities_abused}}): ${derivedCelebCount}
- 7-Day Velocity (TOKEN {{stat:weekly_velocity}}): ${brandData.velocity_7d}
- Velocity Trend (LITERAL): ${brandData.velocity_trend}
- Days Active (TOKEN {{stat:days_active}}): ${longevityDays}
- First Seen (TOKEN {{stat:first_detected}}): ${brandData.first_seen_at}
- Last Seen (TOKEN {{stat:last_active}}): ${brandData.last_seen_at}
- Status: ${brandData.status}
COUNTRIES TARGETED: ${(brandData.geo_list || []).join(', ') || 'Unknown'}
AD CREATIVE SAMPLES (ILLUSTRATIVE SUBSET of {{stat:ad_creatives}} total — examples only; NEVER cite this sample's size as a finding, e.g. do not write "${samples ? Math.min(8, (creativeSample || []).length) : 0} sampled ads"):
${samples || '(none)'}`
}

// ─── Stage runner with model chain + attempt diagnostics ─────────────
async function runStage(label, chain, system, user, opts, attempts) {
  let lastErr = null
  for (const modelKey of chain) {
    const t0 = Date.now()
    let res = null
    // Clamp the stage's requested ceiling to THIS model's own max so one stage
    // can ask for "as much as you've got": a stage passing 16384 lets Opus use
    // its full 16384 while Sonnet honors its 8192 cap — no over-request on
    // models that can't deliver, full headroom on the ones that can. Stages
    // passing a small budget (e.g. 4096) are unaffected by the min().
    const reqTokens = Math.min(opts.maxTokens || 4096, MODELS[modelKey]?.maxTokens || 4096)
    try {
      res = await callModel(modelKey, system, user, {
        maxTokens: reqTokens,
        timeoutMs: opts.timeoutMs || 150000,
        // YMYL writers run at raised reasoning effort where the timeout
        // budget allows (core/trust have 240s within a 600s lambda). Only
        // the primary model in the chain gets the bump; the faster fallback
        // models stay at their default for predictable recovery latency.
        ...(opts.effort && modelKey === chain[0] ? { effort: opts.effort } : {}),
      })
      const json = extractJSON(res.text)
      // Audit 2026-07-05 (R8): a max_tokens stop whose braces repairJSON
      // managed to close used to count as SUCCESS — silently amputated
      // content (half an item_list, missing self_check) shipped as if
      // complete. Truncated output is a failed attempt even when it parses;
      // advance the chain (next model may have a higher cap) or fail loudly.
      if (res.stopReason === 'max_tokens') {
        throw new Error(`output truncated at max_tokens (${res.outputTokens || '?'} tok) despite parseable JSON — content amputated`)
      }
      attempts.push({
        label, model: modelKey, resolvedModel: res.resolvedModel || modelKey,
        durationMs: Date.now() - t0, ok: true, stopReason: res.stopReason || null,
        maxTokens: reqTokens,
        inputTokens: res.inputTokens || null, outputTokens: res.outputTokens || null,
      })
      return { json, res }
    } catch (e) {
      // A JSON-parse failure right after a max_tokens stop is truncation, not
      // a malformed model — say so, so the admin modal points at the real fix
      // (raise this stage's maxTokens) instead of a generic "Incomplete JSON".
      const truncated = res && res.stopReason === 'max_tokens'
      lastErr = truncated
        ? new Error(`output truncated at max_tokens (${res.outputTokens || '?'} tok) — raise maxTokens for stage '${label}'`)
        : e
      attempts.push({
        label, model: modelKey, resolvedModel: res?.resolvedModel || modelKey,
        durationMs: Date.now() - t0, ok: false,
        stopReason: res?.stopReason || null, outputTokens: res?.outputTokens || null,
        error: String(lastErr?.message || lastErr).slice(0, 200),
      })
    }
  }
  // No deterministic stub for YMYL review content — fail loud.
  throw new Error(`Review pipeline stage '${label}' exhausted models [${chain.join(', ')}]: ${lastErr?.message}`)
}

// ─── Stage prompts ────────────────────────────────────────────────────

function skeletonPrompts(ctx) {
  const { brandData, threat, currentYear, blocks } = ctx
  // ── Archetype rotation (audit 2026-07-05, W4d) ─────────────────────
  // A single stamped title/headline template across an 11k-brand corpus is
  // exactly the R42/R43 metadata-template-uniformity fingerprint the
  // algorithmic-authorship-gate warns trips Google's scaled-content-abuse
  // policy. Rotate ≥3 archetypes, seeded by brand name so regeneration is
  // deterministic per brand while the corpus varies.
  const archetypeSeed = [...String(brandData.slug || brandData.name || '')]
    .reduce((h, ch) => ((h * 31 + ch.charCodeAt(0)) >>> 0), 7)
  // Offset per call site so title/headline/summary indices decorrelate —
  // otherwise every brand picks the SAME index across all three arrays.
  let pickCall = 0
  const pick = (arr) => arr[(archetypeSeed + 7919 * pickCall++) % arr.length]

  const titleFormat = threat.frameAsScam
    ? pick([
        `Is {Brand} a Scam? {Score}/100 Threat Score [{Year}]`,
        `{Brand} Scam Warning: {Score}/100 Threat Score [{Year}]`,
        `{Brand} Exposed — {Score}/100 Threat Score [{Year}]`,
        `{Brand}: Confirmed Scam Evidence [{Year}]`,
      ])
    : pick([
        `{Brand} Review: {Score}/100 Threat Score [{Year}]`,
        `Is {Brand} Legit? {Score}/100 Threat Score [{Year}]`,
        `{Brand} Investigation: What Our Data Shows [{Year}]`,
        `{Brand} Review [{Year}]: Red Flags & Evidence`,
      ])
  const headlineFormat = pick([
    `{Brand} Review: {N} Red Flags Exposed by CryptoKiller Intelligence`,
    `{N} Red Flags in the {Brand} Operation: A CryptoKiller Investigation`,
    `Inside {Brand}: {N} Red Flags Our Ad Surveillance Uncovered`,
    `What {X} Ad Creatives Reveal About {Brand}: {N} Red Flags`,
  ])
  const summaryOpener = threat.frameAsScam
    ? pick([
        `'{Brand} is a confirmed crypto scam with a {score}/100 threat score.'`,
        `'CryptoKiller's surveillance data confirms {Brand} as a crypto scam ({score}/100 threat score).'`,
        `'Evidence marks {Brand} as a confirmed crypto scam — threat score {score}/100.'`,
      ])
    : pick([
        `'{Brand} ${threat.prose}, scoring {score}/100 on Crypto Killer's threat index.'`,
        `'Crypto Killer's threat index scores {Brand} at {score}/100: ${threat.prose}.'`,
        `'{Brand} carries a {score}/100 threat score — ${threat.prose}.'`,
      ])

  const system = `You are an investigative crypto fraud analyst at Crypto Killer writing the HEADLINE LAYER of a scam review. Your copy must pass Google E-E-A-T for YMYL and survive a defamation review.

${blocks.tier}

${blocks.statRules}

${ANTI_SLOP}

${JSON_RULES}

{
  "title": "SEO title under 60 chars. Format: ${titleFormat}",
  "headline": "H1. Format: ${headlineFormat} ({N} = your red-flag count, {X} = the creative count token)",
  "alternative_headline": "60-110 char variant — different phrasing, not a synonym swap",
  "meta_description": "Under 155 chars. Brand, threat score, evidence count, ${currentYear}. ${threat.frameAsScam ? 'May use scam/fraudulent language.' : 'HEDGED language only — never call the brand a scam.'}",
  "summary": "2-3 sentences MAX, under 250 chars total. First sentence: ${summaryOpener} Second: one key stat (as token).",
  "key_takeaways": ["5-6 bullets. Each contains a specific number from intelligence data (tokens for live stats). Declaration-first."],
  "verdict": "ONE sentence, under 80 chars, badge-label format. ${threat.frameAsScam ? `Declarative. Style: '${brandData.name} ${threat.verdictOpener}.'` : `HEDGED investigative ONLY. Template: '${brandData.name} ${threat.verdictOpener}.'`}",
  "target_keyword": "2-6 words. Typical: '${brandData.name.toLowerCase()} review'${threat.frameAsScam ? ` or 'is ${brandData.name.toLowerCase()} a scam'` : ''}",
  "author_persona_id": "one of: webb | nair | ortiz | pepi | majithia. Default for this tier: ${threat.frameAsScam ? 'webb' : 'nair'}"
}`

  const user = `Write the headline layer for the ${currentYear} review of ${brandData.name}.

${blocks.intelligence}

${blocks.celeb}

Answer the canonical question "Is ${brandData.name} a scam?" in the summary, tier-appropriately.`
  return { system, user }
}

function corePrompts(ctx) {
  const { brandData, threat, blocks } = ctx
  const system = `You are an investigative crypto fraud analyst at Crypto Killer writing the EVIDENCE BODY of a scam review.

${blocks.tier}

${blocks.entityType}

${blocks.statRules}

${blocks.celeb}

${FCA_BLOCK}

${ANTI_SLOP}

═══ KORAY SEMANTIC RULES ═══
- CENTRAL ENTITY: ${brandData.name} in subject position of every opening sentence.
- MICRO VECTORS: how_it_works = technical mechanics per attack stage; red_flags = behavioral/visual identification signals. Do not drift into general crypto advice.
- EAV triplets in every section. 3 concrete examples for every plural noun.

═══ VISUAL PLACEHOLDERS ═══
Include at least 2 inline placeholders across the two fields, the first within the opening 200 words of how_it_works:
[CHART NEEDED: description | Alt: alt text] / [IMAGE NEEDED: ...] / [SCREENSHOT NEEDED: ...] / [DIAGRAM NEEDED: ...]
Each with unique, specific alt text.
PLACEMENT RULE: a placeholder lives INSIDE a stage paragraph (appended after a sentence) — NEVER as its own paragraph. how_it_works must split into EXACTLY 4 \\n\\n-separated paragraphs, no more, no fewer — the renderer maps each paragraph to one funnel-stage card.

═══ {{VERIFY}} TAGS ═══
Tag claims needing human confirmation: {{VERIFY: claim | named source}}. Name specific documents, never vague.

${JSON_RULES}

{
  "how_it_works": "EXACTLY 4 paragraphs separated by \\n\\n, each 50-80 words. Each paragraph MUST begin with its inline label: 'STAGE 1 — <Title>:', 'STAGE 2 — <Title>:', etc. (uppercase STAGE, em-dash, title, colon). Default stage titles: 1 Celebrity Impersonation & Ads, 2 The Funnel & Deposit, 3 Fake Profits & Manipulation, 4 The Withdrawal Trap (rename to fit the real funnel if entity type differs). The labels are parsing anchors — renderers strip them for display but rely on them to split stages even if paragraph breaks get lost. Each paragraph cites specific numbers (tokens for live stats). ${threat.frameAsScam ? '' : 'Frame stages as how operations LIKE THIS typically work — conditional language where evidence is incomplete.'}",
  "red_flags": [{"flag": "Under 8 words", "category": "ONE of: celebrity_abuse | geo_spread | velocity | regulatory | withdrawal | social_proof | funnel_mechanics | financial_promises", "detail": "70-100 words. 2+ specific numbers. Declaration-first. Ends with a verdict. Each flag covers a DISTINCT category — never two flags with the same category value."}]
}
Emit 5-8 red_flags.`

  const user = `Write the evidence body for ${brandData.name}.

${blocks.intelligence}

${blocks.ledger}

Ground every claim in the intelligence data or the ledger.`
  return { system, user }
}

function trustPrompts(ctx) {
  const { brandData, threat, currentDate, blocks } = ctx
  const system = `You are an investigative crypto fraud analyst at Crypto Killer writing the TRUST LAYER of a scam review (E-E-A-T critical fields).

${blocks.tier}

${blocks.statRules}

${FCA_BLOCK}

${ICP_BLOCK}

${ANTI_SLOP}

${JSON_RULES}

{
  "protection_steps": "150-200 words, actionable: (1) report to IC3.gov/local authorities, (2) contact your bank promptly to ask about a chargeback — dispute windows are time-limited and vary by bank and card network (do NOT state a specific number of days), (3) FTC at ReportFraud.ftc.gov, (4) document everything. MUST warn about recovery scams (follow-up scammers promising to retrieve lost funds).",
  "not_for_you": "80-120 words. Named scenarios where this review may NOT apply. MUST include one line a competitor would never publish — specific enough to scare off a lead. Strongest single trust signal.",
  "methodology": "150-200 words. EXPERIENCE SIGNAL. CryptoKiller scanned N ad networks between {{stat:first_detected}} and {{stat:last_active}}, captured {{stat:ad_creatives}} creatives. NAME the regulatory cross-checks: every investigated brand is checked against the UK FCA Financial Services Register and FCA Warning List (via the FCA's official register API) and SEC EDGAR full-text search. If the ledger contains an FCA/EDGAR finding for THIS brand, state that result. Pattern matching against {{platform_stat:total_brands_tracked}} documented scam brands (use the token EXACTLY as written — never replace it with a number). Do NOT imply FCA/SEC endorsement, affiliation, or privileged access — we query their public databases.",
  "expertise_depth": "80-120 words. Why Crypto Killer is qualified. Mention regulator cross-check capability (public databases — no implied endorsement).",
  "experience_signals": ["3-5 first-person observations from investigating THIS brand that only an investigator would know"],
  "disclaimer": "YMYL disclaimer with the investigation date range ({{stat:first_detected}} to {{stat:last_active}}) and scope limitations. Dated ${currentDate}."
}`

  const user = `Write the trust layer for ${brandData.name}.

${blocks.intelligence}

${blocks.ledger}

Speak to all four ICP segments. [GENERIC] ledger sources may ONLY be cited in protection_steps.`
  return { system, user }
}

function faqPrompts(ctx) {
  const { brandData, threat, blocks } = ctx
  const system = `You write the FAQ layer of a Crypto Killer scam review, optimized for AI Overview extraction.

${blocks.tier}

${blocks.statRules}

${ICP_BLOCK}

${ANTI_SLOP}

═══ EXTRACTABILITY ═══
Every answer: 40-60 words, standalone (makes sense out of context), declaration-first, one data point (token for live stats), one concrete action.

${JSON_RULES}

{
  "faq": [{"question": "Natural search query", "answer": "40-60 words"}]
}
Emit 5-8 items. REQUIRED coverage (TOPICS, not fixed wordings):
1. Canonical: "Is ${brandData.name} a scam?" — ${threat.frameAsScam ? 'answer declaratively' : 'answer with tier-appropriate hedging'} (this exact question IS fixed — it's the search query)
2. Regulation status — vary the phrasing ("Is X regulated?", "Does X have a license?", "Is X registered with the FCA/SEC?")
3. Fund recovery — vary the phrasing ("Can I get my money back…", "How do I recover funds…", "What should I do if I deposited…")
4. One question a concerned family member would search — in their words
5. The remaining 1-4 items MUST be brand-specific (a celebrity used in the ads, the dominant target country, the funnel mechanic) — NEVER reuse a generic question that would fit every review. Identical FAQ sets across thousands of reviews are a scaled-content fingerprint (R43).`

  const user = `Write the FAQ for ${brandData.name}.

${blocks.intelligence}

${blocks.ledger}`
  return { system, user }
}

function schemaPrompts(ctx, prose) {
  const { brandData, threat, currentDate, effectiveCelebList, verifiedLandingUrls, blocks } = ctx
  const landingBlock = verifiedLandingUrls.length === 0
    ? '(none — emit claims[].appearance: null for every claim)'
    : verifiedLandingUrls.slice(0, 3).map((u, i) => `${i + 1}. ${u}`).join('\n')

  const system = `You are the schema-enrichment writer for a Crypto Killer scam review. The prose is FINAL — extract and structure, do not rewrite. Every field maps to a JSON-LD @graph node.

${blocks.tier}

${JSON_RULES}

{
  "about_slugs": ["2-5 from: cryptocurrency-fraud, investment-fraud, celebrity-endorsement-scam, pig-butchering, deepfake, ponzi-scheme, advance-fee-scam, romance-scam, impersonation, wire-fraud, money-laundering. Deepfake-celebrity cases include BOTH celebrity-endorsement-scam AND deepfake. Unknown slugs silently dropped — do not invent."],
  "mention_slugs": ["5-30. Every named entity in the prose: one slug per celebrity from the CELEBRITY list (slugified, ASCII-folded, hyphenated, Latin-transliterated for Arabic/CJK), regulator slugs cited (sec, fca, ftc, cysec, asic...), country slugs for each COUNTRIES TARGETED entry."],
  "speakable_selectors": [".review-summary", ".key-takeaways"],
  "citations": [{"name": "...", "url": "MUST be a ledger URL", "type": "NewsArticle|GovernmentService|ScholarlyArticle|Report|Legislation|CreativeWork", "publisher": "..."}],
  "dataset": ${threat.frameAsScam ? '"REQUIRED."' : '"Best-available or null."'} {"name": "CryptoKiller ${brandData.name} Scam Intelligence Dataset", "description": "{{stat:celebrities_abused}} celebrities impersonated across {{stat:ad_creatives}} creatives in {{stat:countries_targeted}} countries over {{stat:days_active}} days", "keywords": ["cryptocurrency fraud", "celebrity impersonation", "scam intelligence"], "creator": {"@type": "Organization", "name": "CryptoKiller"}, "measurementTechnique": "Automated ad-creative surveillance across Meta, Google, TikTok, X ad libraries, cross-referenced against the FCA Financial Services Register, FCA Warning List, and SEC EDGAR", "variableMeasured": ["Ad Creative Count", "Celebrity Impersonations", "Country Targets", "Campaign Duration (days)", "Weekly Creative Velocity"], "temporalCoverage": "${brandData.first_seen_at}/${brandData.last_seen_at}", "spatialCoverage": ["one entry per COUNTRIES TARGETED country, English exonym verbatim"]},
  "item_reviewed": {"type": "FinancialProduct (most crypto scams) | Service | SoftwareApplication | Organization — NEVER Thing", "name": "${brandData.name} verbatim", "description": "1-2 sentences describing what the scam PRETENDS to be, under 250 chars", "url": "scam's live domain if in ledger, else null", "alternateName": null, "sameAs": "array of regulator warning URLs naming this brand (ledger only, max 3) or null"},
  "item_list": "Celebrity-impersonation cases: {name, description, numberOfItems, itemListOrder: 'Unordered', items: [{position, name, description, entitySlug}]} — ALL ${effectiveCelebList.length} celebrities from the list, in order, 1-sentence role + how impersonated each. Non-celebrity scams: numberOfItems: 0, items: []",
  "how_to": {"name": "...", "description": "...", "totalTime": "...", "step": [{"@type": "HowToStep", "position": 1, "name": "...", "text": "...", "url": null}]} — 4-6 steps from protection_steps (report, chargeback, document, block),
  "quotes": [{"text": "FROM LEDGER EXTRACTS ONLY — fabricated quote = hard rejection", "spokenBy": "...", "citation": "ledger URL"}] or [],
  "claims": ${threat.frameAsScam ? `[{"claimReviewed": "${brandData.name} is a legitimate investment platform.", "ratingValue": 1, "ratingLabel": "False", "originator": "${brandData.name}", "appearance": "URL from VERIFIED LANDING URLS or null"}] + 2-3 evidence-backed false claims (fabricated endorsements, fake AI trading). RULES: ratingValue flat integer 1-5 (never nested), ratingLabel from: False|Mostly False|Misleading|Partly True|Mostly True|True, originator = the brand (never 'Unknown scam operators'), appearance = single URL string from VERIFIED LANDING URLS (or null — never a tag array, never fabricated)` : '[] (claims only when frameAsScam=true)'},
  "internal_links": [{"anchor_text": "descriptive", "target_topic": "related topic", "context": "sentence context"}] — 2-3 entries,
  "information_gain_summary": "1-2 sentences: what does this review contain that the top 10 results cannot have?",
  "reddit_test_passed": "BOOLEAN — honest: would r/Scams upvote this?",
  "self_check": {
    "tier": "${threat.tier}",
    "frame_as_scam": ${threat.frameAsScam},
    "used_forbidden_phrases": "BOOLEAN — true if any banned tier phrase appears in title/summary/verdict/meta",
    "entity_type_matches_reality": "BOOLEAN",
    "verdict_uses_tier_opener": "BOOLEAN",
    "celebrity_names_from_list_only": "BOOLEAN — every celebrity name in prose AND item_list appears in the CELEBRITY list (${effectiveCelebList.length} entries)",
    "fca_lists_not_conflated": "BOOLEAN",
    "plural_agreement_checked": "BOOLEAN",
    "internal_contradictions": ["'sentence A | sentence B' pairs you noticed, [] if none"]
  }
}`

  const user = `Extract schema enrichment from this FINAL review prose for ${brandData.name}:

${JSON.stringify(prose, null, 1).slice(0, 9000)}

CELEBRITY NAMES (${effectiveCelebList.length}): ${effectiveCelebList.join(', ') || 'None detected'}
COUNTRIES TARGETED: ${(brandData.geo_list || []).join(', ') || 'Unknown'}

${blocks.ledger}

═══ VERIFIED LANDING URLS (ONLY valid claims[].appearance values — copy verbatim) ═══
${landingBlock}

Accessed date for citations: ${currentDate}`
  return { system, user }
}

/**
 * Normalize how_it_works toward the 4-paragraph contract. Tolerates
 * literal "\n" escapes, inline STAGE markers (any case), and overflow.
 * Returns { text, count } — count is the paragraph count BEFORE the
 * overflow merge, so callers can detect under-delivery (count < 4).
 */
function normalizeHowItWorks(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return { text: raw, count: 0 }
  const unescaped = raw.replace(/\\n/g, '\n')
  let paras = unescaped.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
  if (paras.length < 4) {
    const inlineSplit = unescaped
      .split(/(?=\bSTAGE\s+[1-9]\s*(?:[—–\-:]|\())/i)
      .map((p) => p.trim())
      .filter((p) => p.length > 0)
    if (inlineSplit.length > paras.length) paras = inlineSplit
  }
  const count = paras.length
  if (paras.length > 4) paras = [...paras.slice(0, 3), paras.slice(3).join(' ')]
  return { text: paras.join('\n\n'), count }
}

// ─── Orchestrator ─────────────────────────────────────────────────────

/**
 * @param {object} args — same inputs contentWriterPrompt receives
 * @param {function} onProgress — SSE-style progress callback
 * @returns {{ reviewContent, pipelineStages, contentResultShim }}
 */
async function runReviewPipeline(args, onProgress = () => {}) {
  const {
    brandData, creativeSample, longevityDays, currentDate,
    sourceLedger, cleanCelebrityList, threat, verifiedLandingUrls = [],
  } = args

  const effectiveCelebList = Array.isArray(cleanCelebrityList) ? cleanCelebrityList : []
  const derivedCelebCount = effectiveCelebList.length
  const currentYear = new Date(currentDate).getFullYear()

  const blocks = {
    tier: buildTierBlock(brandData, threat),
    entityType: buildEntityTypeBlock(brandData),
    statRules: buildStatBlock(brandData, longevityDays, derivedCelebCount),
    celeb: buildCelebBlock(effectiveCelebList, derivedCelebCount, brandData),
    ledger: buildLedgerBlock(sourceLedger, brandData),
    intelligence: buildIntelligenceBlock(brandData, longevityDays, derivedCelebCount, creativeSample),
  }
  const ctx = { brandData, threat, currentDate, currentYear, effectiveCelebList, verifiedLandingUrls, blocks }

  const attempts = []

  // Stage A — skeleton (tier-critical copy)
  onProgress({ step: 'pipeline_skeleton', progress: 46, message: 'Stage A: headline layer (title, summary, verdict)...' })
  const sk = skeletonPrompts(ctx)
  const skeleton = (await runStage('skeleton', ['claude-sonnet', 'claude-haiku'], sk.system, sk.user, { maxTokens: 2048, timeoutMs: 90000 }, attempts)).json

  // Stages B ∥ C ∥ D
  onProgress({ step: 'pipeline_body', progress: 50, message: 'Stages B/C/D in parallel: evidence body, trust layer, FAQ...' })
  const co = corePrompts(ctx)
  const tr = trustPrompts(ctx)
  const fa = faqPrompts(ctx)
  let [core, trust, faq] = await Promise.all([
    runStage('core', ['claude-opus', 'claude-sonnet'], co.system, co.user, { maxTokens: 4096, timeoutMs: 240000, effort: 'medium' }, attempts).then((r) => r.json),
    runStage('trust', ['claude-opus', 'claude-sonnet'], tr.system, tr.user, { maxTokens: 4096, timeoutMs: 240000, effort: 'medium' }, attempts).then((r) => r.json),
    runStage('faq', ['claude-sonnet', 'claude-haiku'], fa.system, fa.user, { maxTokens: 3072, timeoutMs: 120000 }, attempts).then((r) => r.json),
  ])

  // ── 4-paragraph contract gate (deterministic, one corrective retry) ──
  // The 2026-06-10 14:02 Crest Fundgrove run: the writer emitted one run-on
  // block with a single "STAGE 1 —" anchor, and the page shipped a single
  // mega funnel card. Prompt rules alone don't guarantee structure — so
  // validate after normalization and retry the core stage ONCE with
  // explicit corrective feedback when how_it_works can't be split into 4.
  let hiwNorm = normalizeHowItWorks(core.how_it_works)
  if (hiwNorm.count < 4) {
    onProgress({
      step: 'pipeline_core_retry',
      progress: 58,
      message: `how_it_works arrived as ${hiwNorm.count} paragraph${hiwNorm.count === 1 ? '' : 's'} (contract: 4) — re-running core stage with corrective feedback...`,
    })
    const correctiveUser = `${co.user}

═══ CORRECTION — YOUR PREVIOUS ATTEMPT FAILED VALIDATION ═══
Your previous how_it_works arrived as ${hiwNorm.count} paragraph${hiwNorm.count === 1 ? '' : 's'}. The contract is EXACTLY 4 paragraphs:
- Separate each paragraph with a BLANK LINE (\\n\\n inside the JSON string).
- Begin EVERY paragraph with its label: "STAGE 1 — <Title>:", "STAGE 2 — <Title>:", "STAGE 3 — <Title>:", "STAGE 4 — <Title>:".
- 50-80 words per paragraph. Keep the red_flags array unchanged in quality.
Previous attempt (for reference, fix the STRUCTURE, keep the substance):
${String(core.how_it_works || '').slice(0, 2500)}`
    try {
      const retry = await runStage('core-retry', ['claude-opus', 'claude-sonnet'], co.system, correctiveUser, { maxTokens: 4096, timeoutMs: 240000, effort: 'medium' }, attempts)
      const retryNorm = normalizeHowItWorks(retry.json.how_it_works)
      // Audit 2026-07-05 (R9): two fixes here.
      //  (1) Accept ONLY a retry that hits the exact 4-stage contract. The
      //      old `>=` let a retry that echoed old stage text PLUS new stages
      //      (5-6 chunks) through — the direct mechanism behind the
      //      whatsapp-bot Stage-4 duplication.
      //  (2) Take ONLY how_it_works from the retry. `core = {...retry.json}`
      //      swapped the whole object; a retry that omitted or shrank
      //      red_flags shipped a review with an empty Red Flags section.
      if (retryNorm.count === 4) {
        core.how_it_works = retry.json.how_it_works
        if (Array.isArray(retry.json.red_flags) && retry.json.red_flags.length >= (core.red_flags?.length || 0)) {
          core.red_flags = retry.json.red_flags
        }
        hiwNorm = retryNorm
      } else if (retryNorm.count > hiwNorm.count && retryNorm.count < 4) {
        // Strictly better but still short of contract — take the improvement,
        // keep original red_flags.
        core.how_it_works = retry.json.how_it_works
        hiwNorm = retryNorm
      }
    } catch (retryErr) {
      // Keep the original output — publish-side splitters degrade gracefully
      // to fewer cards; a failed retry must not kill the generation.
      console.warn('[review-pipeline] core retry failed (non-fatal):', retryErr.message)
    }
  }
  core.how_it_works = hiwNorm.text

  // ── Headline count reconciliation (audit 2026-07-05, R10c) ──────────
  // Stage A writes "{Brand} Review: {N} Red Flags Exposed…" BEFORE Stage B
  // decides how many flags exist (5-8 allowed) — the model invented N and
  // nothing reconciled it, producing the Floventra-class self-contradiction
  // (headline says 7, page lists 5). Substitute the real count
  // deterministically in every skeleton field that carries the pattern.
  const actualFlagCount = Array.isArray(core.red_flags) ? core.red_flags.length : 0
  if (actualFlagCount > 0) {
    const RED_FLAG_COUNT_RX = /\b\d{1,2}\s+(red\s+flags?)\b/gi
    for (const field of ['headline', 'alternative_headline', 'title', 'summary']) {
      if (typeof skeleton[field] === 'string' && RED_FLAG_COUNT_RX.test(skeleton[field])) {
        skeleton[field] = skeleton[field].replace(RED_FLAG_COUNT_RX, `${actualFlagCount} $1`)
      }
      RED_FLAG_COUNT_RX.lastIndex = 0
    }
  }

  // Stage E — schema enrichment (consumes final prose)
  onProgress({ step: 'pipeline_schema', progress: 62, message: 'Stage E: schema enrichment from final prose...' })
  const prose = {
    title: skeleton.title, headline: skeleton.headline, summary: skeleton.summary,
    key_takeaways: skeleton.key_takeaways, verdict: skeleton.verdict,
    how_it_works: core.how_it_works, red_flags: core.red_flags,
    protection_steps: trust.protection_steps, not_for_you: trust.not_for_you,
    methodology: trust.methodology, expertise_depth: trust.expertise_depth,
    experience_signals: trust.experience_signals, faq: faq.faq,
  }
  // Schema is the only stage whose output scales with celebrity/geo count:
  // item_list emits one node per celebrity, mention_slugs one slug per
  // celebrity + regulators + every targeted country, plus dataset/claims/
  // how_to/self_check. High-count brands (e.g. Legacy Bitfundex: 67
  // celebrities, 16 geos) overran the old 4096 cap, truncating the JSON
  // mid-object → "Incomplete JSON in response". We request the max (16384).
  // OPUS FIRST: runStage clamps maxTokens to each model's own ceiling, so a
  // Sonnet-first chain would attempt the largest call in the pipeline with
  // only 8192 tokens — half the budget — and predictably truncate on big
  // brands before Opus ever got a turn. Opus (16384 ceiling) leads; Sonnet
  // is the fallback for the smaller-schema majority.
  const scPrompt = schemaPrompts(ctx, prose)
  // Schema is enrichment metadata (JSON-LD nodes, internal links), NOT the
  // user-visible YMYL verdict prose — so unlike the prose stages it must not
  // take the whole review down with it. The prose (B+C+D) is already final and
  // validated; buildReviewSchema() derives the core Organization/Review/FAQ
  // graph from that prose regardless. If schema enrichment can't be produced
  // even after the hardened parser's repair pass, degrade to an empty
  // enrichment object: every consumer below coalesces (`|| []`, `?? null`),
  // and /polish + auto-fix can backfill enrichment later. Fail loud in
  // diagnostics so the gap is visible, but ship the review.
  let schema
  try {
    schema = (await runStage('schema', ['claude-opus', 'claude-sonnet'], scPrompt.system, scPrompt.user, { maxTokens: 16384, timeoutMs: 180000 }, attempts)).json
  } catch (schemaErr) {
    console.error('[review-pipeline] schema enrichment failed — shipping review without enrichment:', schemaErr.message)
    onProgress({
      step: 'pipeline_schema_degraded', progress: 64,
      message: `Schema enrichment unavailable (${schemaErr.message.slice(0, 120)}) — review will ship with base schema; re-run /polish to backfill.`,
    })
    schema = {}
  }

  // ── Deterministic post-processing (things the monolith trusted the LLM for)

  // how_it_works normalization + 4-paragraph contract enforcement happens
  // at the contract gate right after Stage B (normalizeHowItWorks + one
  // corrective core retry) — by this point core.how_it_works is final.

  const proseText = JSON.stringify(prose)
  const verifyTagsCount = (proseText.match(/\{\{(?:VERIFY|RESEARCH NEEDED|SOURCE NEEDED):/g) || []).length

  const ledgerUrls = new Set((sourceLedger || []).map((s) => s.url))
  const citations = (Array.isArray(schema.citations) ? schema.citations : []).filter((c) => c?.url && ledgerUrls.has(c.url))
  const quotes = (Array.isArray(schema.quotes) ? schema.quotes : []).filter((q) => !q?.citation || ledgerUrls.has(q.citation))

  // sources[] derived from the verified ledger — never LLM-invented.
  const sources = (sourceLedger || []).slice(0, 8).map((s) => ({
    title: s.title, url: s.url, type: s.type || 'news', accessed_date: currentDate,
  }))

  const reviewContent = {
    // Stage A
    title: skeleton.title,
    headline: skeleton.headline,
    alternative_headline: skeleton.alternative_headline,
    meta_description: skeleton.meta_description,
    summary: skeleton.summary,
    key_takeaways: skeleton.key_takeaways || [],
    verdict: skeleton.verdict,
    target_keyword: skeleton.target_keyword,
    author_persona_id: skeleton.author_persona_id,
    // Stage B
    how_it_works: core.how_it_works,
    red_flags: core.red_flags || [],
    // Stage C
    protection_steps: trust.protection_steps,
    not_for_you: trust.not_for_you,
    methodology: trust.methodology,
    expertise_depth: trust.expertise_depth,
    experience_signals: trust.experience_signals || [],
    disclaimer: trust.disclaimer,
    // Stage D
    faq: faq.faq || [],
    // Stage E
    about_slugs: schema.about_slugs || [],
    mention_slugs: schema.mention_slugs || [],
    speakable_selectors: schema.speakable_selectors || ['.review-summary', '.key-takeaways'],
    citations,
    dataset: schema.dataset ?? null,
    item_reviewed: schema.item_reviewed ?? null,
    item_list: schema.item_list ?? null,
    how_to: schema.how_to ?? null,
    quotes,
    claims: Array.isArray(schema.claims) ? schema.claims : [],
    internal_links: schema.internal_links || [],
    information_gain_summary: schema.information_gain_summary || '',
    reddit_test_passed: !!schema.reddit_test_passed,
    self_check: schema.self_check || null,
    // Deterministic
    verify_tags_count: verifyTagsCount,
    sources,
  }

  const outputTokens = attempts.filter((a) => a.ok).reduce((sum, a) => sum + (a.outputTokens || 0), 0)
  const stageModels = attempts.filter((a) => a.ok).map((a) => `${a.label}:${a.resolvedModel}`)

  // Shim so the route's downstream diagnostics (ai_model, content_model,
  // content_tokens, models_used) keep working without modification.
  const contentResultShim = {
    text: '',
    stopReason: 'end_turn',
    model: 'review-pipeline-v1',
    resolvedModel: `review-pipeline-v1 [${stageModels.join(', ')}]`,
    label: 'Review Pipeline (5-stage)',
    outputTokens,
    usedFallback: attempts.some((a) => !a.ok),
  }

  onProgress({
    step: 'pipeline_done',
    progress: 68,
    message: `Review pipeline complete: ${attempts.filter((a) => a.ok).length}/${attempts.length} stage attempts ok, ${outputTokens} output tokens total`,
  })

  return { reviewContent, pipelineStages: attempts, contentResultShim }
}

module.exports = { runReviewPipeline }
