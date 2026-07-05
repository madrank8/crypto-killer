/**
 * Multi-Model AI Abstraction Layer
 *
 * Supports Claude (Anthropic), GPT-5.4 (OpenAI), and Gemini (Google).
 * Each model can be called with a unified interface.
 * Falls back to Claude if requested model's API key is unavailable.
 */

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || ''
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || ''
const GOOGLE_AI_API_KEY = process.env.GOOGLE_AI_API_KEY || ''

// ─── Model Definitions ───

// Model pins audited 2026-06-11 (content-writing-feature-audit):
// - Opus 4-6 → 4-8 (current GA flagship; 4-6 was two generations behind)
// - Gemini 2.5 → 3.x (2.5 line is legacy; 3.5 Flash is the STABLE frontier
//   workhorse per ai.google.dev/gemini-api/docs/models, 3.1 Pro is Preview
//   with 2M context — preview models get ≥2 weeks deprecation notice, so
//   watch the changelog)
// - GPT-5.4-mini/nano kept (still current cost tier; 5.5 exists for frontier)
const MODELS = {
  'claude-opus': {
    provider: 'anthropic',
    model: 'claude-opus-4-8',
    maxTokens: 16384,
    label: 'Claude Opus',
  },
  'claude-sonnet': {
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    maxTokens: 8192,
    label: 'Claude Sonnet',
  },
  'claude-haiku': {
    provider: 'anthropic',
    model: 'claude-haiku-4-5-20251001',
    maxTokens: 8192,
    label: 'Claude Haiku',
  },
  'gpt-5.4-mini': {
    provider: 'openai',
    model: 'gpt-5.4-mini',
    maxTokens: 8192,
    label: 'GPT-5.4 Mini',
  },
  'gpt-5.4-nano': {
    provider: 'openai',
    model: 'gpt-5.4-nano',
    maxTokens: 8192,
    label: 'GPT-5.4 Nano',
  },
  'gemini-flash': {
    provider: 'google',
    model: 'gemini-3.5-flash',
    maxTokens: 8192,
    label: 'Gemini 3.5 Flash',
  },
  'gemini-pro': {
    provider: 'google',
    model: 'gemini-3.1-pro-preview',
    maxTokens: 8192,
    label: 'Gemini 3.1 Pro (Preview)',
  },
}

// Claude models that default to high-effort adaptive thinking on the API.
// Without an explicit override, 6–8k-token article generation can take 3+
// minutes and blow past lambda timeouts. We default these to 'low' via the
// `output_config.effort` API field (top-level `effort` is silently ignored
// — see the effort doc reference below). Callers can pass options.effort to
// bump it back up for tasks that benefit from deeper reasoning (e.g.
// quality audit, complex synthesis).
// Reference: https://platform.claude.com/docs/en/build-with-claude/effort
const HIGH_EFFORT_DEFAULT_MODELS = new Set([
  'claude-opus-4-6',
  'claude-opus-4-7',
  'claude-opus-4-8',
  'claude-sonnet-4-6',
])

async function fetchWithTimeout(url, init = {}, timeoutMs = 0) {
  if (!timeoutMs || timeoutMs <= 0) {
    return fetch(url, init)
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } catch (err) {
    if (err && err.name === 'AbortError') {
      throw new Error(`Model request timed out after ${timeoutMs}ms`)
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

// ─── Provider availability ───

function isProviderAvailable(provider) {
  switch (provider) {
    case 'anthropic': return !!ANTHROPIC_API_KEY
    case 'openai': return !!OPENAI_API_KEY
    case 'google': return !!GOOGLE_AI_API_KEY
    default: return false
  }
}

// ─── Resolve model with fallback ───

function resolveModel(preferred) {
  const model = MODELS[preferred]
  if (!model) throw new Error(`Unknown model: ${preferred}`)

  if (isProviderAvailable(model.provider)) {
    return { ...model, key: preferred }
  }

  // Fallback chain: try Claude Sonnet → Claude Haiku
  const fallbacks = ['claude-sonnet', 'claude-haiku']
  for (const fb of fallbacks) {
    const fbModel = MODELS[fb]
    if (isProviderAvailable(fbModel.provider)) {
      return { ...fbModel, key: fb, fallbackFrom: preferred }
    }
  }

  throw new Error(`No AI model available. Set at least ANTHROPIC_API_KEY.`)
}

// ─── Provider-specific API calls ───

async function callAnthropic(model, systemPrompt, userPrompt, options = {}) {
  const body = {
    model: model.model,
    max_tokens: options.maxTokens || model.maxTokens,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  }

  // Override the high-effort adaptive-thinking default on Claude 4.6+ models
  // so long-form writers don't spend the entire request thinking. The effort
  // parameter MUST be nested under `output_config` — top-level `effort` is
  // silently ignored by the API, which is what was making our previous
  // `body.effort = 'low'` ineffective and letting Claude run at its default
  // `high` effort (3+ minute latencies on 6–8k-token writers, cascading
  // into the deterministic fallback path on the writer routes).
  // Callers can explicitly pass options.effort = 'medium' | 'high' | 'max'
  // to bump it back up.
  // Reference: https://platform.claude.com/docs/en/build-with-claude/effort
  if (HIGH_EFFORT_DEFAULT_MODELS.has(model.model)) {
    body.output_config = { effort: options.effort || 'low' }
  } else if (options.effort) {
    body.output_config = { effort: options.effort }
  }

  const res = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      // NOTE: previously sent `anthropic-beta: output-128k-2025-02-19`. Per
      // Anthropic's Claude 4 migration guide, this legacy header has no
      // effect on Claude 4+ models — they support 64k output natively
      // (128k on 4.7). Removing it drops a deprecated dependency.
    },
    body: JSON.stringify(body),
  }, options.timeoutMs)

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Anthropic API error ${res.status}: ${errText}`)
  }

  const data = await res.json()
  return {
    text: data.content?.[0]?.text || '',
    stopReason: data.stop_reason,
    model: model.model,
    provider: 'anthropic',
    inputTokens: data.usage?.input_tokens,
    outputTokens: data.usage?.output_tokens,
  }
}

async function callOpenAI(model, systemPrompt, userPrompt, options = {}) {
  const res = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: model.model,
      max_tokens: options.maxTokens || model.maxTokens,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      ...(options.jsonMode ? { response_format: { type: 'json_object' } } : {}),
    }),
  }, options.timeoutMs)

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`OpenAI API error ${res.status}: ${errText}`)
  }

  const data = await res.json()
  return {
    text: data.choices?.[0]?.message?.content || '',
    stopReason: data.choices?.[0]?.finish_reason,
    model: model.model,
    provider: 'openai',
    inputTokens: data.usage?.prompt_tokens,
    outputTokens: data.usage?.completion_tokens,
  }
}

async function callGoogle(model, systemPrompt, userPrompt, options = {}) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model.model}:generateContent?key=${GOOGLE_AI_API_KEY}`

  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      generationConfig: {
        maxOutputTokens: options.maxTokens || model.maxTokens,
        // Google API does NOT support responseMimeType: 'application/json' when
        // search grounding tools are enabled — they are mutually exclusive.
        // When searchGrounding is on, we get text back and parse JSON manually.
        ...(!options.searchGrounding && options.jsonMode ? { responseMimeType: 'application/json' } : {}),
      },
      // Enable Google Search grounding for source verification
      ...(options.searchGrounding ? {
        tools: [{ googleSearch: {} }],
      } : {}),
    }),
  }, options.timeoutMs)

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Google AI API error ${res.status}: ${errText}`)
  }

  const data = await res.json()
  const candidate = data.candidates?.[0]
  const text = candidate?.content?.parts?.map(p => p.text).join('') || ''

  // Extract grounding metadata if available
  const groundingMetadata = candidate?.groundingMetadata || null

  return {
    text,
    stopReason: candidate?.finishReason,
    model: model.model,
    provider: 'google',
    inputTokens: data.usageMetadata?.promptTokenCount,
    outputTokens: data.usageMetadata?.candidatesTokenCount,
    groundingMetadata,
  }
}

// ─── Unified call interface ───

/**
 * Call an AI model with automatic fallback.
 *
 * @param {string} preferredModel - Model key (e.g., 'claude-opus', 'gpt-5.4-mini', 'gemini-flash')
 * @param {string} systemPrompt - System instructions
 * @param {string} userPrompt - User message
 * @param {object} options - { maxTokens, jsonMode, searchGrounding, effort }
 *   effort: 'low' | 'medium' | 'high' | 'max' — overrides the default thinking
 *           effort on Claude 4.6+ models (defaults to 'low' there for
 *           predictable latency). Sent as `output_config.effort` per the
 *           Anthropic API. No effect on OpenAI/Google providers.
 * @returns {object} { text, stopReason, model, provider, usedFallback, ... }
 */
async function callModel(preferredModel, systemPrompt, userPrompt, options = {}) {
  const resolved = resolveModel(preferredModel)

  // Make provider-down degradation VISIBLE. A silent fallback means a writer
  // or research stage is running on a different (often weaker) model than the
  // pipeline intends — e.g. source research losing Gemini search-grounding and
  // dropping to Claude without live search. On a YMYL pipeline that quality
  // delta must be observable in logs, not invisible. (Audit: writing-process
  // review.)
  if (resolved.fallbackFrom) {
    console.warn(`[ai-models] FALLBACK: requested '${resolved.fallbackFrom}' (${MODELS[resolved.fallbackFrom]?.provider}) unavailable — using '${resolved.key}' (${resolved.provider}). Set the provider API key to restore the intended model.`)
  }

  let result
  switch (resolved.provider) {
    case 'anthropic':
      result = await callAnthropic(resolved, systemPrompt, userPrompt, options)
      break
    case 'openai':
      result = await callOpenAI(resolved, systemPrompt, userPrompt, options)
      break
    case 'google':
      result = await callGoogle(resolved, systemPrompt, userPrompt, options)
      break
    default:
      throw new Error(`Unknown provider: ${resolved.provider}`)
  }

  return {
    ...result,
    requestedModel: preferredModel,
    resolvedModel: resolved.key,
    usedFallback: !!resolved.fallbackFrom,
    fallbackFrom: resolved.fallbackFrom || null,
    label: resolved.label,
  }
}

// ─── JSON extraction helper ───

/**
 * Strict balanced-brace slice. Walks from the first container char, tracking
 * string/escape state, and returns the substring once depth returns to 0.
 * Returns null (never throws) on imbalance so callers can fall through to
 * repair. This is the fast, correct path for clean model output.
 */
function balancedSlice(s) {
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (escaped) { escaped = false; continue }
    if (ch === '\\' && inString) { escaped = true; continue }
    if (ch === '"') { inString = !inString; continue }
    if (inString) continue
    if (ch === '{' || ch === '[') depth++
    else if (ch === '}' || ch === ']') {
      depth--
      if (depth === 0) return s.slice(0, i + 1)
    }
  }
  return null
}

/**
 * Tolerant JSON repair for imperfect LLM output. Handles the failure modes that
 * routinely break large (e.g. 67-celebrity schema) responses despite explicit
 * "valid JSON only" instructions:
 *   - stray UNESCAPED quotes inside a string value (the dominant cause of the
 *     cryptic "Incomplete JSON in response" — one bad quote desyncs a naive
 *     brace-walker so the closing braces are read as in-string and depth never
 *     balances). Resolved via lookahead: a `"` closes the string only when the
 *     next non-space char is one of , } ] :  or EOF; otherwise it is escaped.
 *   - raw control chars (newline/tab/CR) inside strings → escaped.
 *   - truncation (max_tokens) → open strings/arrays/objects are closed at EOF.
 *   - trailing commas and dangling commas/colons at the cut point.
 * Returns a best-effort JSON string; the caller still JSON.parse-validates it.
 */
function repairJSON(s) {
  let out = ''
  const stack = []
  let inString = false
  const n = s.length
  for (let i = 0; i < n; i++) {
    const ch = s[i]
    if (inString) {
      if (ch === '\\') {
        if (i + 1 < n) { out += ch + s[i + 1]; i++ } else { out += '\\\\' }
        continue
      }
      if (ch === '"') {
        let j = i + 1
        while (j < n && (s[j] === ' ' || s[j] === '\t' || s[j] === '\n' || s[j] === '\r')) j++
        const nx = s[j]
        if (nx === undefined || nx === ',' || nx === '}' || nx === ']' || nx === ':') {
          inString = false; out += '"'
        } else {
          out += '\\"' // stray quote inside the value → escape it
        }
        continue
      }
      if (ch === '\n') { out += '\\n'; continue }
      if (ch === '\r') { out += '\\r'; continue }
      if (ch === '\t') { out += '\\t'; continue }
      if (ch.charCodeAt(0) < 0x20) { out += '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'); continue }
      out += ch
      continue
    }
    if (ch === '"') { inString = true; out += '"'; continue }
    if (ch === '{' || ch === '[') { stack.push(ch); out += ch; continue }
    if (ch === '}' || ch === ']') {
      const open = stack[stack.length - 1]
      if ((ch === '}' && open === '{') || (ch === ']' && open === '[')) { stack.pop(); out += ch }
      // else: stray/mismatched close → drop it
      continue
    }
    out += ch
  }
  if (inString) out += '"'
  // Drop a dangling comma/colon left at a truncation point.
  out = out.replace(/[,:]\s*$/, '')
  // A truncation can leave a dangling key with no value (…,"name"). Inside an
  // object that's about to be auto-closed, drop the orphan key.
  if (stack[stack.length - 1] === '{') out = out.replace(/,\s*"[^"]*"\s*$/, '')
  // Close anything left open by truncation.
  while (stack.length) out += stack.pop() === '{' ? '}' : ']'
  // Strip trailing commas (run twice for nested closes).
  out = out.replace(/,\s*([}\]])/g, '$1').replace(/,\s*([}\]])/g, '$1')
  return out
}

/**
 * Extract a JSON value from a model response. Returns the parsed object/array.
 * Strategy: strip code fences → locate the first container → strict balanced
 * parse (fast path) → tolerant repair (handles stray quotes, control chars,
 * truncation). Throws only when even the repaired text won't parse, with a
 * diagnostic snippet so the failure points at the real cause.
 */
function extractJSON(text) {
  if (typeof text !== 'string' || !text) throw new Error('No JSON found in response')

  // Strip a markdown code fence if the whole payload is wrapped in one.
  let src = text
  const fence = src.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence && fence[1].includes('{')) src = fence[1]

  // Locate the first JSON container (object or array), ignoring leading prose.
  const objIdx = src.indexOf('{')
  const arrIdx = src.indexOf('[')
  let startIdx
  if (objIdx === -1 && arrIdx === -1) throw new Error('No JSON found in response')
  else if (objIdx === -1) startIdx = arrIdx
  else if (arrIdx === -1) startIdx = objIdx
  else startIdx = Math.min(objIdx, arrIdx)

  // Try to parse the container at a given offset: strict balanced parse first,
  // then tolerant repair. Returns { ok, value } — never throws.
  const tryAt = (idx) => {
    const body = src.slice(idx)
    const sliced = balancedSlice(body)
    if (sliced != null) {
      try { return { ok: true, value: JSON.parse(sliced.replace(/,\s*([}\]])/g, '$1')) } } catch { /* repair */ }
    }
    try { return { ok: true, value: JSON.parse(repairJSON(body)) } } catch { return { ok: false } }
  }

  const first = tryAt(startIdx)
  if (first.ok) return first.value

  // The earliest brace was prose (e.g. a chatty "{note} here:" preamble), not
  // the payload. Rescan for the next real object-start (`{` followed by a key
  // quote) and try once more before giving up.
  const objStart = src.indexOf('{"', startIdx + 1)
  if (objStart !== -1) {
    const second = tryAt(objStart)
    if (second.ok) return second.value
  }

  const head = src.slice(startIdx, startIdx + 120).replace(/\s+/g, ' ')
  throw new Error(`Incomplete JSON in response (repair failed; starts: ${head})`)
}

// ─── Availability report ───

function getAvailableModels() {
  return {
    anthropic: isProviderAvailable('anthropic'),
    openai: isProviderAvailable('openai'),
    google: isProviderAvailable('google'),
    models: Object.entries(MODELS).map(([key, m]) => ({
      key,
      label: m.label,
      provider: m.provider,
      available: isProviderAvailable(m.provider),
    })),
  }
}

module.exports = { callModel, extractJSON, getAvailableModels, MODELS }
