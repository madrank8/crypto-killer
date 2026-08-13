'use strict'

const SET_FIELD_ALLOWLIST = new Set([
  'not_for_you',
  'meta_description',
  'summary',
  'disclaimer',
])

const REPLACEABLE_FIELDS = new Set([
  'full_article',
  'summary',
  'meta_description',
  'disclaimer',
  'not_for_you',
  'headline',
  'title',
])

function cloneRow(row) {
  return {
    ...row,
    sources: Array.isArray(row.sources) ? row.sources.map((s) => ({ ...s })) : row.sources,
    citations: Array.isArray(row.citations) ? row.citations.map((c) => ({ ...c })) : row.citations,
    sections: Array.isArray(row.sections)
      ? row.sections.map((s) => (s && typeof s === 'object' ? { ...s } : s))
      : row.sections,
  }
}

function ledgerUrls(row) {
  const urls = new Set()
  for (const list of [row.sources, row.citations]) {
    if (!Array.isArray(list)) continue
    for (const item of list) {
      const u = item && (item.url || item.href)
      if (typeof u === 'string' && u) urls.add(u)
    }
  }
  return urls
}

function hostFromUrl(url) {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
}

function ledgerHosts(row) {
  const hosts = new Set()
  for (const u of ledgerUrls(row)) {
    const h = hostFromUrl(u)
    if (h) hosts.add(h)
  }
  return hosts
}

function extractHttpUrls(text) {
  const out = []
  const re = /https?:\/\/[^\s"'<>)]+/gi
  let m
  while ((m = re.exec(String(text || ''))) !== null) {
    out.push(m[0].replace(/[.,;:]+$/, ''))
  }
  return out
}

function extractMultiDigitRuns(text) {
  return String(text || '').match(/\d{2,}/g) || []
}

function countOccurrences(haystack, needle) {
  if (!needle) return 0
  let count = 0
  let idx = 0
  while (true) {
    const found = haystack.indexOf(needle, idx)
    if (found === -1) break
    count += 1
    idx = found + needle.length
  }
  return count
}

function replaceOnce(haystack, find, replace) {
  const idx = haystack.indexOf(find)
  if (idx === -1) return haystack
  return haystack.slice(0, idx) + replace + haystack.slice(idx + find.length)
}

function validateReplaceFabrication(row, find, replace) {
  const allowedHosts = ledgerHosts(row)
  for (const url of extractHttpUrls(replace)) {
    const host = hostFromUrl(url)
    if (!host) continue
    if (!allowedHosts.has(host)) {
      return 'invented url/host not in ledger: ' + host
    }
  }

  const findDigits = new Set(extractMultiDigitRuns(find))
  for (const run of extractMultiDigitRuns(replace)) {
    if (!findDigits.has(run)) {
      return 'invented number/stat not present in find: ' + run
    }
  }
  return null
}

function applyReplaceSpan(patch, op, applied, rejected) {
  const field = op.field
  if (!REPLACEABLE_FIELDS.has(field) && typeof patch[field] !== 'string') {
    rejected.push({ why: 'replace_span unsupported field: ' + field })
    return
  }
  const current = patch[field]
  if (typeof current !== 'string') {
    rejected.push({ why: 'replace_span field is not a string: ' + field })
    return
  }
  const find = String(op.find ?? '')
  const replace = String(op.replace ?? '')
  const occurrences = countOccurrences(current, find)
  if (occurrences !== 1) {
    rejected.push({
      why: 'replace_span find must exist exactly once (found ' + occurrences + ')',
    })
    return
  }
  const fabrication = validateReplaceFabrication(patch, find, replace)
  if (fabrication) {
    rejected.push({ why: fabrication })
    return
  }
  patch[field] = replaceOnce(current, find, replace)
  applied.push({ what: 'replace_span on ' + field })
}

function applyInsertLedgerLink(patch, op, applied, rejected) {
  if (op.field !== 'full_article') {
    rejected.push({ why: 'insert_ledger_link only supports field full_article' })
    return
  }
  const current = patch.full_article
  if (typeof current !== 'string') {
    rejected.push({ why: 'insert_ledger_link full_article is not a string' })
    return
  }
  const find = String(op.find ?? '')
  const url = String(op.url ?? '')
  const urls = ledgerUrls(patch)
  if (!urls.has(url)) {
    rejected.push({ why: 'insert_ledger_link url not in sources/citations ledger' })
    return
  }
  const occurrences = countOccurrences(current, find)
  if (occurrences !== 1) {
    rejected.push({
      why: 'insert_ledger_link find must exist exactly once (found ' + occurrences + ')',
    })
    return
  }
  const anchor = op.anchor != null ? String(op.anchor) : find
  const link = '<a href="' + url + '">' + anchor + '</a>'
  patch.full_article = replaceOnce(current, find, link)
  applied.push({ what: 'insert_ledger_link ' + url })
}

function applySetSectionBody(patch, op, applied, rejected) {
  const index = op.index
  if (!Array.isArray(patch.sections)) {
    rejected.push({ why: 'set_section_body requires sections array' })
    return
  }
  if (typeof index !== 'number' || index < 0 || index >= patch.sections.length) {
    rejected.push({ why: 'set_section_body invalid index: ' + index })
    return
  }
  const section = patch.sections[index]
  if (!section || typeof section !== 'object') {
    rejected.push({ why: 'set_section_body missing section at ' + index })
    return
  }
  const previousBody = typeof section.body === 'string' ? section.body : ''
  const newBody = String(op.body ?? '')
  const fabrication = validateReplaceFabrication(patch, previousBody, newBody)
  if (fabrication) {
    rejected.push({ why: fabrication })
    return
  }
  patch.sections[index] = { ...section, body: newBody }
  applied.push({ what: 'set_section_body at ' + index })
}

function applySetField(patch, op, applied, rejected) {
  const field = op.field
  if (!SET_FIELD_ALLOWLIST.has(field)) {
    rejected.push({ why: 'set_field field not allowlisted: ' + field })
    return
  }
  if (typeof op.value === 'string') {
    const previous = typeof patch[field] === 'string' ? patch[field] : ''
    const fabrication = validateReplaceFabrication(patch, previous, op.value)
    if (fabrication) {
      rejected.push({ why: fabrication })
      return
    }
  }
  patch[field] = op.value
  applied.push({ what: 'set_field ' + field })
}

function applyRemoveSourceUrls(patch, op, applied, rejected) {
  const urls = Array.isArray(op.urls) ? op.urls : null
  if (!urls) {
    rejected.push({ why: 'remove_source_urls requires urls array' })
    return
  }
  if (!Array.isArray(patch.sources)) {
    patch.sources = []
  }
  const drop = new Set(urls)
  const before = patch.sources.length
  patch.sources = patch.sources.filter((s) => !drop.has(s && s.url))
  applied.push({ what: 'remove_source_urls removed ' + (before - patch.sources.length) })
}

function applySurgicalPatches(row, patches) {
  const patch = cloneRow(row || {})
  const applied = []
  const rejected = []
  const list = Array.isArray(patches) ? patches : []

  for (const op of list) {
    if (!op || typeof op !== 'object' || !op.op) {
      rejected.push({ why: 'invalid patch op' })
      continue
    }
    switch (op.op) {
      case 'replace_span':
        applyReplaceSpan(patch, op, applied, rejected)
        break
      case 'set_section_body':
        applySetSectionBody(patch, op, applied, rejected)
        break
      case 'set_field':
        applySetField(patch, op, applied, rejected)
        break
      case 'remove_source_urls':
        applyRemoveSourceUrls(patch, op, applied, rejected)
        break
      case 'insert_ledger_link':
        applyInsertLedgerLink(patch, op, applied, rejected)
        break
      default:
        rejected.push({ why: 'unknown op: ' + op.op })
    }
  }

  return { patch, applied, rejected }
}

function surgicalFixPrompt({ kind, fails, rowExcerpt }) {
  return {
    system: 'You fix YMYL publish-gate failures surgically. Return JSON only. Never invent numbers, URLs, testimonials, or credentials. Prefer removing or softening unverified claims. Mark load_bearing_claims only when removing the claim would gut the section thesis.',
    user: JSON.stringify({
      kind,
      fails,
      rowExcerpt,
      allowed_ops: [
        'replace_span',
        'set_section_body',
        'set_field',
        'remove_source_urls',
        'insert_ledger_link',
      ],
      response_shape: {
        patches: [],
        load_bearing_claims: [{ text: '', why_load_bearing: '' }],
        notes: '',
      },
      instructions:
        'List classified fails and quote offending spans from hard_fail_reason / gate reasons. Prefer remove/soften. Ban inventing stats/URLs. Use only allowed_ops. For replace_span, find must match exactly once; do not invent hosts or multi-digit numbers absent from find. insert_ledger_link url must already exist on sources/citations.',
    }, null, 2),
  }
}

module.exports = { applySurgicalPatches, surgicalFixPrompt }
