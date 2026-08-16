'use strict'

/**
 * Callable models for the Quality Fix Agent surgical step.
 *
 * The OpenAI project on production does not have access to flagship `gpt-5.4`
 * (403 model_not_found). Mirror the auditor pin: gpt-5.4-mini → claude-sonnet.
 */

const QUALITY_FIX_MODELS = ['gpt-5.4-mini', 'claude-sonnet']

/**
 * @param {Function} callModelFn
 * @param {string} system
 * @param {string} user
 * @param {object} [options]
 * @returns {Promise<{ text: string, model: string, resolvedModel?: string }>}
 */
async function callQualityFixModel(callModelFn, system, user, options = {}) {
  if (typeof callModelFn !== 'function') {
    throw new Error('callQualityFixModel requires callModelFn')
  }
  let lastErr = null
  for (const model of QUALITY_FIX_MODELS) {
    try {
      const result = await callModelFn(model, system, user, {
        jsonMode: true,
        effort: 'high',
        timeoutMs: 120000,
        label: options.label || 'quality-fix-surgical',
        ...options,
      })
      return result
    } catch (err) {
      lastErr = err
      const msg = err && err.message ? err.message : String(err)
      console.warn(`[quality-fix] model ${model} failed: ${msg.slice(0, 200)} — trying next`)
    }
  }
  throw lastErr || new Error('No quality-fix surgical model available')
}

module.exports = { callQualityFixModel, QUALITY_FIX_MODELS }
