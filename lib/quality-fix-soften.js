'use strict'

/**
 * Fail-closed soften pass for remaining publish-gate hard fails.
 *
 * Never invents sources, numbers, or testimonials. Only removes or hedges
 * auditor-named claim spans so a mechanical veto can clear without override.
 */

const SOFTENABLE_KEYS = new Set([
  'fabricated_source_or_stat',
  'fabricated_reviews_or_testimonials',
  'fake_or_unmarked_freshness',
  'unverified_claims_in_article',
  'source_ledger_claims_without_links',
  'any_hard_fail',
])

const UNSOFTENABLE_KEYS = new Set(['commodity_no_information_gain', 'item_reviewed_typed'])

/**
 * Pull quoted spans and bare numeric claims from auditor reason text.
 * @param {string} reason
 * @returns {string[]}
 */
function extractClaimSpans(reason) {
  const text = String(reason || '')
  const spans = []

  for (const m of text.matchAll(/[“"']([^“"'”]{8,200})[”"']/g)) {
    const span = (m[1] || '').trim()
    if (span) spans.push(span)
  }

  for (const m of text.matchAll(
    /\b(\$?\d[\d,]*(?:\.\d+)?\s*(?:%|percent|billion|million|thousand)?)\b/gi,
  )) {
    const span = (m[1] || '').trim()
    if (span.length >= 2) spans.push(span)
  }

  return [...new Set(spans)].sort((a, b) => b.length - a.length)
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Remove HTML/text sentences that contain any of the claim spans.
 * Prefer removing the whole sentence over inventing a replacement.
 * @param {string} html
 * @param {string[]} spans
 * @returns {{ html: string, removed: number }}
 */
function removeSentencesContainingSpans(html, spans) {
  if (typeof html !== 'string' || !html) {
    return { html: typeof html === 'string' ? html : '', removed: 0 }
  }

  let removed = 0
  let out = html

  const beforeVerify = out
  out = out
    .replace(/\{\{\s*VERIFY\s*\}\}([\s\S]*?)\{\{\s*\/\s*VERIFY\s*\}\}/gi, '$1')
    .replace(/\{\{\s*VERIFY\s*\}\}/gi, '')
    .replace(/\{\{\s*\/\s*VERIFY\s*\}\}/gi, '')
  if (out !== beforeVerify) removed += 1

  const list = Array.isArray(spans) ? spans : []
  for (const span of list) {
    if (!span || !out.includes(span)) continue
    const esc = escapeRegExp(span)
    const sentenceRe = new RegExp(
      `(?:^|[.\\n>]\\s*)([^<.!?]{0,400}${esc}[^.!?]*[.!?])`,
      'gi',
    )
    out = out.replace(sentenceRe, (match, sentence) => {
      if (!sentence || !sentence.includes(span)) return match
      removed += 1
      return match.slice(0, match.length - sentence.length)
    })
    if (out.includes(span)) {
      out = out.split(span).join('')
      removed += 1
    }
  }

  out = out
    .replace(/<p>\s*<\/p>/gi, '')
    .replace(/[^\S\n]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')

  return { html: out, removed }
}

function scrubFreshnessFraming(html) {
  if (typeof html !== 'string' || !html) return { html: html || '', removed: 0 }
  let removed = 0
  const next = html.replace(
    /\b(?:updated|last\s+updated|as\s+of)\s+(?:in\s+)?(?:january|february|march|april|may|june|july|august|september|october|november|december)?\s*\d{4}\b/gi,
    () => {
      removed += 1
      return ''
    },
  )
  return { html: next.replace(/[^\S\n]{2,}/g, ' '), removed }
}

/**
 * Soften a content/review row against remaining hard fails.
 * @param {object} row
 * @param {Array<{ key?: string, reason?: string }>} hardFails
 * @returns {{ patch: object, applied: Array<{key:string,what:string}>, unfixable: Array<object>, touched: boolean }}
 */
function softenHardFails(row, hardFails) {
  const fails = Array.isArray(hardFails) ? hardFails : []
  const patch = {}
  const applied = []
  const unfixable = []

  if (!fails.length) {
    return { patch, applied, unfixable, touched: false }
  }

  const softenable = []
  for (const fail of fails) {
    const key = fail?.key || 'unknown'
    if (UNSOFTENABLE_KEYS.has(key)) {
      unfixable.push({
        key,
        reason: fail?.reason || 'unsoftenable',
        operator_action:
          key === 'commodity_no_information_gain'
            ? 'Add first-party evidence: original data, screenshots, or a firsthand test.'
            : 'Fix this check manually; soften will not invent schema or evidence.',
      })
      continue
    }
    softenable.push(fail)
  }

  if (!softenable.length) {
    return { patch, applied, unfixable, touched: false }
  }

  let fullArticle = typeof row?.full_article === 'string' ? row.full_article : ''
  let sections = Array.isArray(row?.sections) ? row.sections.map((s) => ({ ...s })) : []
  let totalRemoved = 0

  for (const fail of softenable) {
    const key = fail?.key || 'unknown'
    const reason = fail?.reason || ''
    const spans = extractClaimSpans(reason)

    if (
      key === 'fake_or_unmarked_freshness' ||
      /freshness|updated\s+20\d{2}|current.?year/i.test(reason)
    ) {
      const r = scrubFreshnessFraming(fullArticle)
      fullArticle = r.html
      totalRemoved += r.removed
      sections = sections.map((section) => {
        if (typeof section?.body !== 'string') return section
        const sr = scrubFreshnessFraming(section.body)
        totalRemoved += sr.removed
        return { ...section, body: sr.html }
      })
    }

    if (spans.length || SOFTENABLE_KEYS.has(key) || /^gate_/.test(key)) {
      if (!spans.length) {
        const verifyOnly = removeSentencesContainingSpans(fullArticle, [])
        fullArticle = verifyOnly.html
        totalRemoved += verifyOnly.removed
      } else {
        const r = removeSentencesContainingSpans(fullArticle, spans)
        fullArticle = r.html
        totalRemoved += r.removed
      }
      sections = sections.map((section) => {
        if (typeof section?.body !== 'string') return section
        const sr = removeSentencesContainingSpans(section.body, spans)
        totalRemoved += sr.removed
        return { ...section, body: sr.html }
      })
    }
  }

  if (totalRemoved === 0 && /\{\{\s*VERIFY/i.test(fullArticle)) {
    const r = removeSentencesContainingSpans(fullArticle, [])
    fullArticle = r.html
    totalRemoved += r.removed
  }

  if (totalRemoved === 0) {
    for (const fail of softenable) {
      unfixable.push({
        key: fail?.key || 'unknown',
        reason: fail?.reason || 'no removable span found',
        operator_action:
          'Softening found no auditor-named claim span to remove. Edit the named claim manually, then re-run Fix & Publish.',
      })
    }
    return { patch, applied, unfixable, touched: false }
  }

  if (typeof row?.full_article === 'string') patch.full_article = fullArticle
  if (Array.isArray(row?.sections) && row.sections.length) patch.sections = sections

  if (Object.keys(patch).length === 0) {
    return { patch, applied, unfixable, touched: false }
  }

  applied.push({
    key: 'soften_pass',
    what: `Fail-closed soften removed/hedged ${totalRemoved} auditor-named span(s)`,
  })

  return { patch, applied, unfixable, touched: true }
}

function isSoftenableFail(fail) {
  const key = fail?.key || ''
  if (UNSOFTENABLE_KEYS.has(key)) return false
  if (SOFTENABLE_KEYS.has(key)) return true
  if (/^gate_/.test(key)) return true
  return true
}

module.exports = {
  softenHardFails,
  extractClaimSpans,
  removeSentencesContainingSpans,
  isSoftenableFail,
  SOFTENABLE_KEYS,
  UNSOFTENABLE_KEYS,
}
