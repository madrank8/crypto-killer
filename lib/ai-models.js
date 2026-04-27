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

const MODELS = {
  'claude-opus': {
    provider: 'anthropic',
    model: 'claude-opus-4-6',
    maxTokens: 8192,
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
    model: 'gemini-2.5-flash',
    maxTokens: 8192,
    label: 'Gemini 2.5 Flash',
  },
  'gemini-pro': {
    provider: 'google',
    model: 'gemini-2.5-pro',
    maxTokens: 8192,
    label: 'Gemini 2.5 Pro',
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

function extractJSON(text) {
  const startIdx = text.indexOf('{')
  if (startIdx === -1) throw new Error('No JSON found in response')

  let depth = 0
  let inString = false
  let escaped = false

  for (let i = startIdx; i < text.length; i++) {
    const ch = text[i]
    if (escaped) { escaped = false; continue }
    if (ch === '\\' && inString) { escaped = true; continue }
    if (ch === '"' && !escaped) { inString = !inString; continue }
    if (inString) continue
    if (ch === '{' || ch === '[') depth++
    else if (ch === '}' || ch === ']') {
      depth--
      if (depth === 0) {
        let jsonStr = text.slice(startIdx, i + 1)
        // Repair trailing commas
        jsonStr = jsonStr.replace(/,\s*([}\]])/g, '$1')
        return JSON.parse(jsonStr)
      }
    }
  }

  throw new Error('Incomplete JSON in response')
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
