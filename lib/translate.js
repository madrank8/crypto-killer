/**
 * Review Translation Engine
 *
 * Translates a master EN review row into a target locale (it/es/de/fr/pt-BR)
 * by calling an AI model in JSON mode. Returns a populated payload ready to
 * INSERT/UPSERT into review_translations.
 *
 * ─── Model choice + override ───
 * The default is Claude Haiku 4.5 — fast (~30-60s/translation), cheap, and
 * the Anthropic API key is our primary credential (the article pipeline
 * already runs through it). Haiku 4.5 produces high-quality translations
 * and is uniformly accessible across our Anthropic project.
 *
 * GPT-5.4-mini was the original choice but on 2026-05-18 we hit a 403
 * "model_not_found" on the OpenAI project — the model wasn't enabled at
 * the project level. Rather than gate the whole translation feature on a
 * dashboard click, we made the default Anthropic-based and added a per-deploy
 * override via the TRANSLATION_MODEL env var.
 *
 * To switch:
 *   - Default (no env var): claude-haiku
 *   - To use OpenAI:  TRANSLATION_MODEL=gpt-5.4-mini  (after enabling at OpenAI dashboard)
 *   - To use Sonnet:  TRANSLATION_MODEL=claude-sonnet  (higher quality, ~2x latency)
 *   - To use Gemini:  TRANSLATION_MODEL=gemini-flash   (different vendor entirely)
 *
 * Valid model keys live in lib/ai-models.js MODELS registry.
 *
 * ─── Why two API calls per translation ───
 * full_article can be 8-12K tokens of output on its own; the short fields
 * and the structured JSON arrays (faq/red_flags/key_takeaways) together
 * fit in ~4K tokens. Bundling them in one call regularly truncated full_article.
 * Splitting gives each call comfortable headroom under the 16K output ceiling.
 *
 * ─── YMYL provenance (V1) ───
 * Per Phase-1 scope, V1 translations are stamped translation_method=ai_assisted,
 * translator_name='Crypto Killer Editorial Team', reviewed_at=now() so they
 * can be published immediately. The publish-gate trigger in migration 004
 * blocks ai_full → published if reviewed_at is null, which is the rail for
 * stricter V2 review policy.
 *
 * ─── Slug strategy ───
 * Default: per-locale slug = master slug (so /it/review/<masterSlug> works
 * out of the box). Editor can override to a native-language slug after the
 * fact (e.g., master 'polso-crescianza' → IT slug 'recensione-polso-crescianza').
 */

const { callModel, extractJSON } = require('@/lib/ai-models')

const TRANSLATE_PROMPT_VERSION = 'translate-v1'

// Resolved at module load. Falls back to claude-haiku (Anthropic primary
// credential, uniformly accessible). Override via TRANSLATION_MODEL env var
// to any key in lib/ai-models.js MODELS — e.g. 'gpt-5.4-mini', 'claude-sonnet',
// 'gemini-flash'. Invalid keys would throw at runtime, not at load.
const DEFAULT_AI_MODEL = (process.env.TRANSLATION_MODEL || 'claude-haiku').trim()

// ─── Locale → cultural anchor ────────────────────────────────────────
// Per-locale system-prompt fragment. Keeps the translator anchored in the
// target culture's financial-journalism register so output reads native,
// not like literally-translated American English. References major
// business-news publications the target audience recognizes (Il Sole 24
// Ore for IT, Handelsblatt for DE, etc.) — Google's QRG section 4.6.6
// rewards content that reads like it was written for the audience, not
// translated TO them.

const LOCALES = {
  'it': {
    bcp47: 'it-IT',
    name: 'Italian',
    anchor:
      'Write as a senior Italian financial journalist publishing for Il Sole 24 Ore readers. ' +
      'Use professional Italian register — never machine-translated American English. ' +
      'Italian-language financial terminology: piattaforma di trading (not "trading platform"), ' +
      'frode finanziaria (not "scam"), recensione (not "review"). Currency in EUR. ' +
      'Use "voi" plural / formal "Lei" when addressing the reader directly.',
  },
  'es': {
    bcp47: 'es-ES',
    name: 'Spanish',
    anchor:
      'Write as a senior Spanish-language financial journalist publishing for readers of ' +
      'El País Negocios and Cinco Días. Neutral Spanish register that reads natively for ' +
      'both Spain and Latin America (avoid hyper-regional slang). Use plataforma de inversión, ' +
      'estafa financiera (or fraude when more accurate), reseña or análisis. Address the reader ' +
      'with "usted" formal. Currency in EUR (mention USD when discussing US-listed offers).',
  },
  'de': {
    bcp47: 'de-DE',
    name: 'German',
    anchor:
      'Write as a senior German financial journalist publishing for Handelsblatt and Manager Magazin ' +
      'readers. Formal German business register — precise, sober, fact-driven. Use Anlageplattform, ' +
      'Anlagebetrug or Finanzbetrug (distinguish carefully), Bewertung or Test. Address the reader ' +
      'with "Sie" formal throughout. Currency in EUR. German compound-noun construction is expected ' +
      '— do not avoid it.',
  },
  'fr': {
    bcp47: 'fr-FR',
    name: 'French',
    anchor:
      'Write as a senior French financial journalist publishing for Les Échos and Le Figaro ' +
      'Économie readers. Formal French register — precise, structured, factual. Use plateforme ' +
      'd\'investissement, arnaque or escroquerie (escroquerie is the legal term, prefer it for ' +
      'serious cases), avis or critique. Address the reader with "vous" formal. Currency in EUR.',
  },
  'pt-BR': {
    bcp47: 'pt-BR',
    name: 'Brazilian Portuguese',
    anchor:
      'Write as a senior Brazilian financial journalist publishing for Valor Econômico and ' +
      'Folha de S.Paulo Mercado readers. Brazilian Portuguese specifically (NOT European) — ' +
      'Brazilian spelling, Brazilian word choices, Brazilian financial terminology. Use ' +
      'plataforma de investimento, golpe financeiro or fraude, avaliação or análise. ' +
      'Address the reader with "você". Currency in BRL when relevant to Brazilian audiences, ' +
      'USD/EUR for international offers.',
  },
}

// ─── Field groups ───────────────────────────────────────────────────
// Splits the translation work into two calls: short-and-structured (Call A)
// and full_article (Call B). See module-docstring above for why.

const SHORT_TEXT_FIELDS = [
  'title',
  'meta_description',
  'headline',
  'alternative_headline',
  'summary',
  'how_it_works',
  'verdict',
  'not_for_you',
  'protection_steps',
  'methodology',
  'disclaimer',
  'expertise_depth',
]

// JSON-shaped fields. Master may use varying key shapes per writer-persona
// (e.g. red_flags items can be { flag, detail } OR { title, description } —
// see sync-shape.js lines 655-656 / 992-997). The translation prompt instructs
// the model to PRESERVE the source object's exact key structure rather than
// normalizing — otherwise translations break downstream renderers that read
// both shapes.
const JSON_FIELD_NAMES = ['red_flags', 'faq', 'key_takeaways']

// ─── Helpers ────────────────────────────────────────────────────────

function buildSystemPrompt(locale) {
  const meta = LOCALES[locale]
  if (!meta) throw new Error(`translate: unsupported locale '${locale}'. V1 supports: ${Object.keys(LOCALES).join(', ')}`)

  return [
    `You are a professional translator localizing scam-investigation review content into ${meta.name} (${meta.bcp47}).`,
    '',
    meta.anchor,
    '',
    'CRITICAL RULES:',
    '- Preserve ALL factual claims, names, brand names, URLs, dates, scam scores, and numeric values exactly as in source.',
    '- Brand names, person names, place names: keep in original form unless there is a well-established native-language exonym.',
    '- Preserve markdown formatting (headings, lists, **bold**, *italic*, links).',
    '- Preserve HTML if present (tags, attributes, src/href values).',
    '- Output ONLY a valid JSON object matching the exact schema requested. No prose before or after.',
    '- Do NOT add disclaimers, opinions, or commentary not present in the source.',
    '- Do NOT add the phrase "This article was translated by AI" or similar disclosure — that surfaces at render time via a separate UI block, not in body content.',
    '- If a source field is null, empty, or absent, output null for that field (do NOT invent content).',
    '- Maintain the SAME tone polarity as source. A "Confirmed Scam" verdict in EN should be equally direct in target language; do not soften.',
  ].join('\n')
}

function pickShortFields(source) {
  const out = {}
  for (const f of SHORT_TEXT_FIELDS) out[f] = source[f] ?? null
  return out
}

function pickJsonFields(source) {
  const out = {}
  for (const f of JSON_FIELD_NAMES) {
    const val = source[f]
    out[f] = Array.isArray(val) ? val : []
  }
  return out
}

// ─── Call A: short + structured fields ──────────────────────────────

// Detect cases where the model stopped because it hit the maxTokens budget
// rather than finishing naturally. When this happens the JSON is necessarily
// truncated and extractJSON will throw "Incomplete JSON in response". We
// catch this earlier with a clearer error so admins know the actual cause
// (and the fix — bump maxTokens, or chunk the article).
//
// stop_reason vocabulary varies by provider:
//   anthropic: 'end_turn' | 'max_tokens' | 'tool_use' | 'stop_sequence'
//   openai:    'stop' | 'length' | 'function_call' | 'content_filter'
//   google:    'STOP' | 'MAX_TOKENS' | 'SAFETY' | etc.
function isTruncatedByMaxTokens(stopReason) {
  if (!stopReason) return false
  const s = String(stopReason).toLowerCase()
  return s === 'max_tokens' || s === 'length' || s === 'max_output_tokens'
}

async function translateShortAndStructured(masterRow, locale, options = {}) {
  const systemPrompt = buildSystemPrompt(locale)
  const shortInput = pickShortFields(masterRow)
  const jsonInput = pickJsonFields(masterRow)

  const userPrompt = [
    `Translate the following review content into ${LOCALES[locale].name} (${LOCALES[locale].bcp47}).`,
    '',
    'INPUT (source = English):',
    '```json',
    JSON.stringify({ short_fields: shortInput, structured_fields: jsonInput }, null, 2),
    '```',
    '',
    'OUTPUT REQUIREMENTS:',
    '',
    '1. "short_fields" — output an object with EXACTLY these keys (translate each string',
    '   value; if the source value is null/empty, output null):',
    '   ' + SHORT_TEXT_FIELDS.join(', '),
    '',
    '2. "structured_fields.red_flags" — output an array of objects. For EACH object in the source:',
    '   - Preserve the EXACT KEY STRUCTURE of the source object (whatever keys are present).',
    '   - Translate every STRING VALUE that is human-prose.',
    '   - Do NOT translate URLs, dates, scores, IDs, code keys, or enum values (e.g. severity: "high").',
    '   - Do NOT rename keys. If source has { "flag": "...", "detail": "..." } output { "flag": "<translated>", "detail": "<translated>" }.',
    '     If source has { "title": "...", "description": "..." } output { "title": "<translated>", "description": "<translated>" }.',
    '',
    '3. "structured_fields.faq" — same rule: preserve source object keys; translate only string values.',
    '   Typically the keys are "question" and "answer" but DO NOT assume — copy whatever keys appear.',
    '',
    '4. "structured_fields.key_takeaways" — array of plain strings; translate each string.',
    '',
    'OUTPUT SCHEMA (top-level shape, do not deviate):',
    '```json',
    '{ "short_fields": { ... }, "structured_fields": { "red_flags": [...], "faq": [...], "key_takeaways": [...] } }',
    '```',
    '',
    'Output ONLY the JSON object. Begin with `{`.',
  ].join('\n')

  const result = await callModel(
    options.model || DEFAULT_AI_MODEL,
    systemPrompt,
    userPrompt,
    {
      jsonMode: true,
      // Short fields + structured arrays usually fit under 4K output tokens,
      // but a brand with many red_flags + a long FAQ list can grow. 12K gives
      // comfortable headroom without burning latency on bigger budgets.
      maxTokens: 12288,
      timeoutMs: options.timeoutMs || 90_000,
    }
  )

  // Detect maxTokens truncation BEFORE attempting to parse — the JSON will
  // necessarily be incomplete and extractJSON would throw the cryptic
  // "Incomplete JSON in response" error. This message tells the admin
  // exactly what to do.
  if (isTruncatedByMaxTokens(result.stopReason)) {
    throw new Error(
      `translate: short-fields response was truncated by maxTokens (stop_reason=${result.stopReason}, model=${result.model}). ` +
      `Increase maxTokens in translateShortAndStructured, or split the input into smaller chunks.`
    )
  }

  const parsed = extractJSON(result.text)
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('translate: short-fields response was not valid JSON')
  }

  return {
    short: parsed.short_fields || {},
    structured: parsed.structured_fields || {},
    _usage: { input: result.inputTokens, output: result.outputTokens, model: result.model },
  }
}

// ─── Call B: full_article ───────────────────────────────────────────
// full_article can be 12-24K output tokens depending on source length and
// target language (Romance languages run ~20-25% longer than EN; Germanic
// languages are roughly even). 32K maxTokens covers any review article
// up to ~5,000 EN source words, which is well past our actual ceiling.
// Claude Haiku 4.5 supports 64K output natively.
//
// Skip the call entirely when source full_article is empty.

async function translateFullArticle(masterRow, locale, options = {}) {
  if (!masterRow.full_article || masterRow.full_article.length < 50) return null

  const systemPrompt = buildSystemPrompt(locale)
  const userPrompt = [
    `Translate the following long-form article into ${LOCALES[locale].name} (${LOCALES[locale].bcp47}).`,
    'Preserve all markdown structure (# headings, ## subheadings, **bold**, lists, blockquotes, links).',
    'Output a JSON object with a single key "full_article" containing the translated markdown as a string.',
    '',
    'INPUT (source = English):',
    '```markdown',
    masterRow.full_article,
    '```',
    '',
    'OUTPUT SCHEMA:',
    '```json',
    '{ "full_article": "<translated markdown>" }',
    '```',
    '',
    'Output ONLY the JSON object. Begin with `{`.',
  ].join('\n')

  const result = await callModel(
    options.model || DEFAULT_AI_MODEL,
    systemPrompt,
    userPrompt,
    {
      jsonMode: true,
      // 32K covers every review article we've shipped so far. Bumping further
      // costs latency without practical upside. If a translation truncates,
      // chunking the article (rather than raising the ceiling) is the right
      // V2 fix.
      maxTokens: 32768,
      timeoutMs: options.timeoutMs || 240_000,
    }
  )

  // Same defense as Call A — surface the actual cause before extractJSON
  // throws "Incomplete JSON in response".
  if (isTruncatedByMaxTokens(result.stopReason)) {
    throw new Error(
      `translate: full_article response was truncated by maxTokens (stop_reason=${result.stopReason}, model=${result.model}). ` +
      `This usually means the source article is unusually long. ` +
      `Either bump translateFullArticle maxTokens above 32768, or chunk the article and translate each chunk separately.`
    )
  }

  const parsed = extractJSON(result.text)
  if (!parsed || typeof parsed !== 'object' || typeof parsed.full_article !== 'string') {
    throw new Error('translate: full_article response was not valid JSON or missing full_article field')
  }

  return {
    full_article: parsed.full_article,
    _usage: { input: result.inputTokens, output: result.outputTokens, model: result.model },
  }
}

// ─── Top-level: build a complete review_translations payload ────────

/**
 * Translate a master review row into a target locale.
 *
 * @param {object} masterRow — the reviews row (must include id, slug, and the translatable fields)
 * @param {string} locale — one of 'it', 'es', 'de', 'fr', 'pt-BR'
 * @param {object} [options]
 *   model {string} — override default model key (default: 'gpt-5.4-mini')
 *   slug {string} — override per-locale slug (default: master slug)
 *   translationMethod {string} — 'ai_full' | 'ai_assisted' | 'human_only' (default: 'ai_assisted')
 *   translatorName {string} — editorial reviewer name (default: 'Crypto Killer Editorial Team')
 *   markReviewed {boolean} — set reviewed_at = now() (default: true for ai_assisted)
 *   timeoutMs {number} — per-call timeout
 *
 * @returns {object} payload ready for INSERT into review_translations
 */
async function translateReview(masterRow, locale, options = {}) {
  if (!masterRow || !masterRow.id) throw new Error('translate: master row missing id')
  if (!LOCALES[locale]) {
    throw new Error(`translate: unsupported locale '${locale}'. V1 supports: ${Object.keys(LOCALES).join(', ')}`)
  }

  const translationMethod = options.translationMethod || 'ai_assisted'
  const translatorName = options.translatorName || 'Crypto Killer Editorial Team'
  const markReviewed = options.markReviewed !== false && translationMethod !== 'ai_full'

  // Run both calls in parallel where possible — they're independent.
  const [shortResult, articleResult] = await Promise.all([
    translateShortAndStructured(masterRow, locale, options),
    translateFullArticle(masterRow, locale, options),
  ])

  const short = shortResult.short
  const structured = shortResult.structured

  // Word count from the translated full_article (or summary fallback)
  const text = articleResult?.full_article || short.summary || ''
  const wordCount = text ? text.trim().split(/\s+/).length : 0

  const now = new Date().toISOString()

  return {
    review_id: masterRow.id,
    locale,
    slug: options.slug || masterRow.slug,
    status: 'draft',

    // Translated content
    title: short.title ?? null,
    meta_description: short.meta_description ?? null,
    headline: short.headline ?? null,
    alternative_headline: short.alternative_headline ?? null,
    summary: short.summary ?? null,
    how_it_works: short.how_it_works ?? null,
    verdict: short.verdict ?? null,
    full_article: articleResult?.full_article ?? null,
    red_flags: Array.isArray(structured.red_flags) ? structured.red_flags : [],
    faq: Array.isArray(structured.faq) ? structured.faq : [],
    key_takeaways: Array.isArray(structured.key_takeaways) ? structured.key_takeaways : [],
    not_for_you: short.not_for_you ?? null,
    protection_steps: short.protection_steps ?? null,
    methodology: short.methodology ?? null,
    disclaimer: short.disclaimer ?? null,
    expertise_depth: short.expertise_depth ?? null,

    // Provenance
    source_review_updated_at: masterRow.updated_at || null,
    translation_method: translationMethod,
    ai_model: shortResult._usage?.model || DEFAULT_AI_MODEL,
    ai_prompt_version: TRANSLATE_PROMPT_VERSION,
    translator_name: translatorName,
    reviewed_at: markReviewed ? now : null,
    word_count: wordCount,

    // Stamps (server will overwrite with now())
    created_at: now,
    updated_at: now,
  }
}

module.exports = {
  translateReview,
  LOCALES,
  SUPPORTED_LOCALES: Object.keys(LOCALES),
  TRANSLATE_PROMPT_VERSION,
}
