import {
  DISCLOSURE_HEADING,
  hasRiskDisclosure,
  appendDisclosureToHtml,
  appendDisclosureToSections,
// Imported with its extension, not as `@/lib/...`: webpack resolves both, but
// Node's ESM loader resolves neither the alias nor an extensionless path, and
// this module has to stay loadable under `node --test` for its fixes to be
// testable without a bundler.
} from './ymyl-disclosure.js'

/**
 * Deterministic remediation of quality-audit hard fails.
 *
 * The publish gate can veto a draft for reasons no editor can act on quickly,
 * and the only escape used to be the override, which disables every other check
 * at once. This module closes the gap from the other side: for the failures whose
 * fix is mechanical, it produces the patch; for the rest, it produces a precise
 * statement of what it could not fix and what a human has to do.
 *
 * Two rules make that division safe to automate:
 *
 *   1. Nothing here guesses. A fix is applied only when its correctness is
 *      provable from the row itself. No model is called, no prose is invented,
 *      no claim is edited to match a source.
 *
 *   2. Anything not provably fixable is reported, never silently passed. The
 *      draft stays unpublished and the operator gets the reason.
 */

/**
 * What a human needs to do, per check, when the fix is not mechanical. Written
 * as instructions rather than restatements of the problem: the failure reason
 * already comes from `evaluateHardFails`, and an operator reading a blocked
 * publish needs the next action, not a second description of the block.
 */
const OPERATOR_ACTIONS = {
  fabricated_source_or_stat:
    'Read the audit\'s hard_fail_reason for the exact figure or quote it could not trace. Then either add a source to the ledger that actually states it, or delete the claim from the article. Do not soften the wording and leave the number.',
  fake_or_unmarked_freshness:
    'Either make a substantive update that earns the recency signal, or remove the "updated"/current-year framing and cite a source from the year the article claims.',
  fabricated_reviews_or_testimonials:
    'Remove any invented user review, testimonial, or rating, or replace it with an attributed quote that links to where it was published (FTC 16 CFR 465).',
  commodity_no_information_gain:
    'Add first-party evidence: original data, a dataset, screenshots of the operator, or a firsthand test. This is a content decision, not a formatting one.',
  not_for_you_block_present:
    'Populate the not_for_you field with who this article is NOT for, then regenerate the article so the block renders into the body.',
  item_reviewed_typed:
    'Set item_reviewed.type to FinancialProduct, Service, SoftwareApplication, or Organization. "Thing" is too vague to earn a review rich result.',
  unverified_claims_in_article:
    'For each unsupported claim, add the source that establishes it to the ledger, or remove the claim.',
  source_ledger_claims_without_links:
    'Link each cited ledger claim in the body to its source, so a reader can check it without leaving the sentence.',
  any_hard_fail:
    'The audit vetoed without a readable per-check answer. Re-run the audit; if the veto survives, read hard_fail_reason and fix what it names.',
}

const DEFAULT_OPERATOR_ACTION =
  'Read the audit verdict on this row (ai_audit.hard_fail_checks) and fix what it names, then re-audit.'

/**
 * Apply every mechanical fix warranted by the failing checks.
 *
 * @param {object} row - the `content` row, as loaded from Supabase
 * @param {Array<{ key: string, reason: string }>} hardFails - `evaluateHardFails().failed`
 * @returns {{
 *   patch: object,
 *   applied: Array<{ key: string, what: string }>,
 *   unfixable: Array<{ key: string, reason: string, operator_action: string }>,
 * }}
 */
function remediateContent(row, hardFails) {
  const patch = {}
  const applied = []
  const unfixable = []
  const fails = Array.isArray(hardFails) ? hardFails : []
  let working = { ...(row || {}) }
  let needsVisualScrub = false
  let needsVerifyScrub = false
  let needsPlaceholderLinkScrub = false
  const deadUrlCandidates = []

  for (const fail of fails) {
    const key = fail?.key
    const reason = fail?.reason || 'no reason recorded'
    const reasonBlob = `${key || ''} ${reason}`

    if (key === 'missing_risk_or_ftc_disclosure') {
      const result = applyDisclosure(working)
      if (result.applied) {
        Object.assign(patch, result.patch)
        working = { ...working, ...result.patch }
        applied.push({ key, what: result.what })
      } else {
        unfixable.push({ key, reason, operator_action: result.operator_action })
      }
      continue
    }

    if (key === 'source_ledger_claims_without_links') {
      const result = applyLedgerInlineLinks(working)
      if (result.applied) {
        Object.assign(patch, result.patch)
        working = { ...working, ...result.patch }
        applied.push({ key, what: result.what })
      } else {
        unfixable.push({ key, reason, operator_action: result.operator_action })
      }
      continue
    }

    if (/visual placeholder|placeholder-box|\[\s*(chart|diagram|image|infographic|screenshot|photo|step-by-step)\s+needed/i.test(reasonBlob)) {
      needsVisualScrub = true
      continue
    }

    if (/dead source|blocked.*url|citation_blocked|hard-dead|invalid_citation/i.test(reasonBlob)) {
      for (const m of String(reason).matchAll(/https?:\/\/[^\s"'<>)\]]+/gi)) {
        deadUrlCandidates.push(m[0].replace(/[.,;:]+$/, ''))
      }
      continue
    }

    if (/\{\{\s*VERIFY|VERIFY\}\}|placeholder target_slug|href=["']#/i.test(reasonBlob)) {
      if (/\{\{\s*VERIFY|VERIFY\}\}/i.test(reasonBlob)) needsVerifyScrub = true
      if (/placeholder target_slug|href=["']#/i.test(reasonBlob)) needsPlaceholderLinkScrub = true
      continue
    }

    unfixable.push({
      key: key || 'unknown',
      reason,
      operator_action: OPERATOR_ACTIONS[key] || DEFAULT_OPERATOR_ACTION,
    })
  }

  if (needsVisualScrub) {
    const scrub = applyVisualPlaceholderScrub(working)
    if (scrub.applied) {
      Object.assign(patch, scrub.patch)
      working = { ...working, ...scrub.patch }
      applied.push({ key: 'visual_placeholder', what: scrub.what })
    } else {
      unfixable.push({
        key: 'visual_placeholder',
        reason: 'Visual placeholder gate reason present but no placeholders found',
        operator_action: 'Scrub remaining [CHART NEEDED]-style tokens in the editor, then re-run Fix & Publish.',
      })
    }
  }

  if (deadUrlCandidates.length) {
    const scrub = applyDeadSourceScrub(working, deadUrlCandidates)
    if (scrub.applied) {
      Object.assign(patch, scrub.patch)
      working = { ...working, ...scrub.patch }
      applied.push({ key: 'dead_source', what: scrub.what })
    } else {
      unfixable.push({
        key: 'dead_source',
        reason: `Could not drop named dead URLs: ${[...new Set(deadUrlCandidates)].join(', ')}`,
        operator_action: 'Remove the dead citation from sources and unlink it in the body, then re-run Fix & Publish.',
      })
    }
  }

  if (needsVerifyScrub) {
    const scrub = applyVerifyMarkerScrub(working)
    if (scrub.applied) {
      Object.assign(patch, scrub.patch)
      working = { ...working, ...scrub.patch }
      applied.push({ key: 'verify_marker', what: scrub.what })
    }
  }

  if (needsPlaceholderLinkScrub) {
    const scrub = applyPlaceholderInternalLinkScrub(working)
    if (scrub.applied) {
      Object.assign(patch, scrub.patch)
      applied.push({ key: 'placeholder_internal_link', what: scrub.what })
    } else {
      unfixable.push({
        key: 'placeholder_internal_link',
        reason: 'Placeholder internal link gate reason present but no # / target_slug tokens found',
        operator_action: 'Replace placeholder internal links with real published URLs, then re-run Fix & Publish.',
      })
    }
  }

  return { patch, applied, unfixable }
}

/**
 * Add the YMYL disclosure to both bodies the site reads.
 *
 * Both are required, and for different readers: `prerender.ts` serves
 * `full_article` to crawlers and only falls back to `sections`, while the client
 * `BlogPostPage` prefers `sections`. Writing one and not the other produces a
 * page where the disclosure appears or vanishes depending on how it was loaded,
 * which for a YMYL disclosure is worse than a consistent absence.
 */
function applyDisclosure(row) {
  const fullArticle = typeof row?.full_article === 'string' ? row.full_article : ''
  const sections = Array.isArray(row?.sections) ? row.sections : []
  const sectionsText = sections.map((s) => `${s?.heading || ''}\n${s?.body || ''}`).join('\n\n')

  if (hasRiskDisclosure(fullArticle, sectionsText)) {
    // The auditor vetoed on a disclosure the article already carries. Appending
    // a second copy would be a visible defect on a live page, so this stops and
    // hands the disagreement to a human — the audit may be describing an older
    // version of the text, which the re-audit that follows will settle.
    return {
      applied: false,
      operator_action:
        'The article already contains a risk / not-financial-advice disclosure, so no block was added. The re-audit will confirm whether the veto was describing an earlier version of the text. If it survives, check that the disclosure is in the article body itself rather than only in a heading or a stray sentence.',
    }
  }

  const patch = {}
  const touched = []

  if (fullArticle.trim()) {
    patch.full_article = appendDisclosureToHtml(fullArticle)
    touched.push('full_article')
  }
  if (sections.length > 0) {
    patch.sections = appendDisclosureToSections(sections)
    touched.push('sections')
  }

  if (touched.length === 0) {
    // Nothing to append to. A draft with no body has not been generated yet, and
    // creating a page whose only content is a disclaimer is not a fix.
    return {
      applied: false,
      operator_action: 'This draft has no article body yet. Run Generate Article first, then remediate.',
    }
  }

  return {
    applied: true,
    patch,
    what: `Appended the standard "${DISCLOSURE_HEADING}" block to ${touched.join(' and ')}`,
  }
}


/**
 * Wrap bare ledger source names in the body with their ledger URLs.
 *
 * Only links phrases that already appear as plain text outside existing
 * anchors, and only to URLs already on the row's sources/citations list.
 * Never invents a URL or changes claim wording.
 */
function escapeHtmlAttr(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function phrasesForSource(source) {
  const url = typeof source?.url === 'string' ? source.url : ''
  const phrases = []
  try {
    const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase()
    if (host.includes('scamadviser')) phrases.push('ScamAdviser')
    if (host.includes('ic3.gov')) phrases.push('IC3')
    if (host.includes('ftc.gov') || host.includes('reportfraud.ftc')) phrases.push('FTC')
  } catch {
    // ignore malformed
  }
  // Host-derived brand tokens only — never invent URLs or guess from free text.
  return [...new Set(phrases)].sort((a, b) => b.length - a.length)
}

function linkBarePhrase(html, phrase, url) {
  if (!html || !phrase || !url) return { html, linked: 0 }
  const href = escapeHtmlAttr(url)
  const escapedPhrase = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // Split into anchor chunks and text chunks; only mutate text chunks.
  const parts = String(html).split(/(<a\b[^>]*>[\s\S]*?<\/a>)/gi)
  let linked = 0
  const out = parts.map((part) => {
    if (/^<a\b/i.test(part)) return part
    // Skip inside HTML tags
    const re = new RegExp(`(?![^<]*>)\\b(${escapedPhrase})\\b`, 'g')
    return part.replace(re, (match) => {
      linked += 1
      return `<a href="${href}">${match}</a>`
    })
  })
  return { html: out.join(''), linked }
}

function applyLedgerInlineLinks(row) {
  const sources = [
    ...(Array.isArray(row?.sources) ? row.sources : []),
    ...(Array.isArray(row?.citations) ? row.citations : []),
  ].filter((s) => s && typeof s.url === 'string' && s.url.startsWith('http'))

  if (sources.length === 0) {
    return {
      applied: false,
      operator_action:
        'No ledger URLs are available to link. Add verified sources to the ledger, then re-run Fix & Publish.',
    }
  }

  let fullArticle = typeof row?.full_article === 'string' ? row.full_article : ''
  let sections = Array.isArray(row?.sections) ? row.sections.map((s) => ({ ...s })) : []
  let totalLinked = 0
  const linkedPhrases = []

  for (const source of sources) {
    for (const phrase of phrasesForSource(source)) {
      if (fullArticle) {
        const r = linkBarePhrase(fullArticle, phrase, source.url)
        fullArticle = r.html
        totalLinked += r.linked
        if (r.linked) linkedPhrases.push(phrase)
      }
      sections = sections.map((section) => {
        if (typeof section?.body !== 'string' || !section.body) return section
        const r = linkBarePhrase(section.body, phrase, source.url)
        if (!r.linked) return section
        totalLinked += r.linked
        linkedPhrases.push(phrase)
        return { ...section, body: r.html }
      })
    }
  }

  if (totalLinked === 0) {
    return {
      applied: false,
      operator_action:
        OPERATOR_ACTIONS.source_ledger_claims_without_links +
        ' No bare ledger brand names were found outside existing links — add an explicit inline link on the cited claim sentence.',
    }
  }

  const patch = {}
  if (typeof row?.full_article === 'string') patch.full_article = fullArticle
  if (Array.isArray(row?.sections) && row.sections.length) patch.sections = sections

  return {
    applied: true,
    patch,
    what: `Linked ${totalLinked} bare ledger mention(s) (${[...new Set(linkedPhrases)].join(', ')}) to existing source URLs`,
  }
}


const VISUAL_PLACEHOLDER_RE =
  /\[\s*(CHART|DIAGRAM|IMAGE|INFOGRAPHIC|SCREENSHOT|PHOTO|STEP-BY-STEP)\s+NEEDED[^\]]*\]/gi

function scrubVisualPlaceholders(text) {
  if (typeof text !== 'string') return text
  return text
    .replace(VISUAL_PLACEHOLDER_RE, '')
    .replace(/[^\S\n]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function applyVisualPlaceholderScrub(row) {
  const patch = {}
  let changed = false
  if (typeof row?.full_article === 'string') {
    const next = scrubVisualPlaceholders(row.full_article)
    if (next !== row.full_article) {
      patch.full_article = next
      changed = true
    }
  }
  if (Array.isArray(row?.sections) && row.sections.length) {
    const sections = row.sections.map((s) => {
      if (!s || typeof s !== 'object') return s
      const next = { ...s }
      if (typeof next.body === 'string') next.body = scrubVisualPlaceholders(next.body)
      if (typeof next.heading === 'string') next.heading = scrubVisualPlaceholders(next.heading)
      return next
    })
    if (JSON.stringify(sections) !== JSON.stringify(row.sections)) {
      patch.sections = sections
      changed = true
    }
  }
  if (!changed) return { applied: false }
  return { applied: true, patch, what: 'Removed visual placeholder tokens from article bodies' }
}

function applyDeadSourceScrub(row, urls) {
  const drop = new Set((Array.isArray(urls) ? urls : []).filter(Boolean))
  if (!drop.size) return { applied: false }

  const patch = {}
  let dropped = 0

  function filterList(list) {
    if (!Array.isArray(list)) return list
    const next = list.filter((item) => {
      const u = item && (item.url || item.href)
      if (typeof u === 'string' && drop.has(u)) {
        dropped += 1
        return false
      }
      return true
    })
    return next
  }

  if (Array.isArray(row?.sources)) {
    const next = filterList(row.sources)
    if (next.length !== row.sources.length) patch.sources = next
  }
  if (Array.isArray(row?.citations)) {
    const next = filterList(row.citations)
    if (next.length !== row.citations.length) patch.citations = next
  }

  function unlinkDead(html) {
    if (typeof html !== 'string' || !html) return html
    let out = html
    for (const url of drop) {
      const esc = String(url).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const re = new RegExp(`<a\\b[^>]*href=["']${esc}["'][^>]*>([\\s\\S]*?)<\\/a>`, 'gi')
      out = out.replace(re, '$1')
    }
    return out
  }

  if (typeof row?.full_article === 'string') {
    const next = unlinkDead(row.full_article)
    if (next !== row.full_article) patch.full_article = next
  }
  if (Array.isArray(row?.sections) && row.sections.length) {
    const sections = row.sections.map((s) => {
      if (!s || typeof s.body !== 'string') return s
      return { ...s, body: unlinkDead(s.body) }
    })
    if (JSON.stringify(sections) !== JSON.stringify(row.sections)) patch.sections = sections
  }

  if (!Object.keys(patch).length) return { applied: false }
  return {
    applied: true,
    patch,
    what: `Dropped ${dropped || drop.size} dead source URL(s) and unlinked them in the body`,
  }
}

function applyVerifyMarkerScrub(row) {
  const patch = {}
  function scrub(html) {
    if (typeof html !== 'string') return html
    return html
      .replace(/\{\{\s*VERIFY\s*\}\}([\s\S]*?)\{\{\s*\/\s*VERIFY\s*\}\}/gi, '$1')
      .replace(/\{\{\s*VERIFY\s*\}\}/gi, '')
      .replace(/\{\{\s*\/\s*VERIFY\s*\}\}/gi, '')
  }
  if (typeof row?.full_article === 'string') {
    const next = scrub(row.full_article)
    if (next !== row.full_article) patch.full_article = next
  }
  if (Array.isArray(row?.sections) && row.sections.length) {
    const sections = row.sections.map((s) =>
      s && typeof s.body === 'string' ? { ...s, body: scrub(s.body) } : s,
    )
    if (JSON.stringify(sections) !== JSON.stringify(row.sections)) patch.sections = sections
  }
  if (!Object.keys(patch).length) return { applied: false }
  return { applied: true, patch, what: 'Removed {{VERIFY}} markers (left claim text for soften/surgical)' }
}

function applyPlaceholderInternalLinkScrub(row) {
  const patch = {}
  function scrub(html) {
    if (typeof html !== 'string') return html
    return html
      .replace(/<a\b[^>]*href=["']#[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi, '$1')
      .replace(/target_slug\s*[:=]\s*["'][^"']+["']/gi, '')
  }
  if (typeof row?.full_article === 'string') {
    const next = scrub(row.full_article)
    if (next !== row.full_article) patch.full_article = next
  }
  if (Array.isArray(row?.sections) && row.sections.length) {
    const sections = row.sections.map((s) =>
      s && typeof s.body === 'string' ? { ...s, body: scrub(s.body) } : s,
    )
    if (JSON.stringify(sections) !== JSON.stringify(row.sections)) patch.sections = sections
  }
  if (!Object.keys(patch).length) return { applied: false }
  return { applied: true, patch, what: 'Unwrapped placeholder # / target_slug internal links' }
}

export {
  remediateContent,
  OPERATOR_ACTIONS,
  applyLedgerInlineLinks,
  applyVisualPlaceholderScrub,
  applyDeadSourceScrub,
}

