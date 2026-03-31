/**
 * Multi-Model AI Abstraction Layer
 *
 * Supports Claude (Anthropic), GPT-4o (OpenAI), and Gemini (Google).
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
    model: 'claude-opus-4-0-20250514',
    maxTokens: 8192,
    label: 'Claude Opus',
  },
  'claude-sonnet': {
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    maxTokens: 8192,
    label: 'Claude Sonnet',
  },
  'claude-haiku': {
    provider: 'anthropic',
    model: 'claude-haiku-4-5-20251001',
    maxTokens: 8192,
    label: 'Claude Haiku',
  },
  'gpt-4o': {
    provider: 'openai',
    model: 'gpt-4o',
    maxTokens: 8192,
    label: 'GPT-4o',
  },
  'gpt-4o-mini': {
    provider: 'openai',
    model: 'gpt-4o-mini',
    maxTokens: 8192,
    label: 'GPT-4o Mini',
  },
  'gemini-flash': {
    provider: 'google',
    model: 'gemini-2.0-flash',
    maxTokens: 8192,
    label: 'Gemini Flash',
  },
  'gemini-pro': {
    provider: 'google',
    model: 'gemini-2.5-pro-preview-06-05',
    maxTokens: 8192,
    label: 'Gemini Pro',
  },
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
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: model.model,
      max_tokens: options.maxTokens || model.maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  })

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
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
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
  })

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

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      generationConfig: {
        maxOutputTokens: options.maxTokens || model.maxTokens,
        ...(options.jsonMode ? { responseMimeType: 'application/json' } : {}),
      },
      // Enable Google Search grounding for source verification
      ...(options.searchGrounding ? {
        tools: [{ googleSearch: {} }],
      } : {}),
    }),
  })

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
 * @param {string} preferredModel - Model key (e.g., 'claude-opus', 'gpt-4o', 'gemini-flash')
 * @param {string} systemPrompt - System instructions
 * @param {string} userPrompt - User message
 * @param {object} options - { maxTokens, jsonMode, searchGrounding }
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
