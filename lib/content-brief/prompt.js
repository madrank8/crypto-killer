'use strict'

/**
 * Format a persisted 12-section content brief for outline / fill prompts.
 * Keeps map-directives (`lib/topical-map/content-brief.js`) separate — this is
 * the Sullivan-gated handoff artifact, not the lightweight map summary.
 */

const isStr = (v) => typeof v === 'string' && v.trim() !== ''

function formatHeadingLines(headings) {
  if (!Array.isArray(headings) || !headings.length) return '(none)'
  return headings.map((h, i) => {
    const parts = [`${i + 1}. [${h.heading_level || 'H2'}] ${h.h2 || '(untitled)'}`]
    if (isStr(h.starting_statement) && !h.starting_statement.startsWith('[')) {
      parts.push(`   starting_statement: ${h.starting_statement}`)
    }
    if (isStr(h.instruction) && !h.instruction.startsWith('[')) {
      parts.push(`   instruction: ${h.instruction}`)
    }
    if (h.ple_unit && typeof h.ple_unit === 'object') {
      const { pixel, letter, byte } = h.ple_unit
      if ([pixel, letter, byte].some((v) => isStr(v) && !String(v).startsWith('['))) {
        parts.push(`   ple_unit: pixel=${pixel || '—'}; letter=${letter || '—'}; byte=${byte || '—'}`)
      }
    }
    return parts.join('\n')
  }).join('\n')
}

function formatFaqSweep(faqSweep) {
  if (!faqSweep || typeof faqSweep !== 'object') return '(none)'
  const items = Array.isArray(faqSweep.items) ? faqSweep.items : []
  if (!items.length) return `${faqSweep.carrier_h2 || 'FAQ'} — items: [] (no unmapped remainder yet)`
  return [
    `carrier_h2: ${faqSweep.carrier_h2 || '(unset)'}`,
    ...items.map((it, i) => {
      const q = it.question || it.query_cluster || '(question)'
      const ans = isStr(it.answer_target) ? it.answer_target : ''
      return `${i + 1}. ${q}${ans ? `\n   answer_target: ${ans}` : ''}`
    }),
  ].join('\n')
}

function formatClaimSeeds(cats) {
  if (!cats || typeof cats !== 'object') return '(none)'
  const lines = []
  for (const [key, list] of Object.entries(cats)) {
    if (!Array.isArray(list) || !list.length) continue
    const cleaned = list.filter((x) => isStr(x)).slice(0, 4)
    if (!cleaned.length) continue
    lines.push(`${key}:`)
    for (const c of cleaned) lines.push(`  - ${c}`)
  }
  return lines.length ? lines.join('\n') : '(none)'
}

/**
 * @param {object|null} brief — content_briefs.brief jsonb
 * @returns {string} empty when nothing useful to inject
 */
function formatFullBriefForPrompt(brief) {
  if (!brief || typeof brief !== 'object') return ''
  const hasSignal =
    isStr(brief.primary_keyword) ||
    isStr(brief.content_type) ||
    (Array.isArray(brief.heading_structure) && brief.heading_structure.length > 0)
  if (!hasSignal) return ''

  const lines = [
    '═══ APPROVED CONTENT BRIEF (Sullivan-gated — follow these directives) ═══',
    // Disambiguate: Sullivan SC-098 vs map page format
    `Sullivan content_type (SC-098): ${brief.content_type || '(unset)'}`,
    `Map content_format (page format — NOT Sullivan): ${brief.content_format || '(unset)'}`,
    `Locale: ${brief.locale || 'en-US'}`,
    brief.orthography_notes ? `Orthography notes: ${brief.orthography_notes}` : null,
    `Primary keyword: ${brief.primary_keyword || '(unset)'}`,
    `Search intent: ${brief.search_intent || '(unset)'}`,
    `Word count target: ${brief.word_count_target || '(unset)'}`,
    `Schema: ${brief.schema_type || '(unset)'}`,
    '',
    'HEADING SKELETON (prefer this H2 order / starting statements):',
    formatHeadingLines(brief.heading_structure),
    '',
    'FAQ SWEEP (long-tail remainder → FAQ H3s):',
    formatFaqSweep(brief.faq_sweep),
    '',
    'CLAIM CATEGORY SEEDS (search targets — not verified citations):',
    formatClaimSeeds(brief.claim_categories),
    '',
    'INTERNAL LINKS:',
    brief.internal_link_targets
      ? JSON.stringify(brief.internal_link_targets)
      : '(none)',
    '═══════════════════════════════════════════════════════════════════════',
  ].filter((l) => l !== null)

  return lines.join('\n')
}

module.exports = { formatFullBriefForPrompt }
