'use strict'

const { isPillarHubPage } = require('./koray-structure')

function sheetCell(page, header) {
  const s = page?._sheet || {}
  return String(s[header] ?? '').trim()
}

function displayTitle(page) {
  const fromPage = String(page?.title ?? '').trim()
  if (fromPage) return fromPage
  const fromSheet = sheetCell(page, 'Page Title (Title Tag Style)')
  return fromSheet || '(untitled)'
}

function requiresInternalLinks(page) {
  if (page?.topic_type === 'pillar' || page?.topic_type === 'cluster') return false
  if (page?.structural_shell === true) return false
  if (isPillarHubPage(page)) return false
  return true
}

/**
 * Hard-gate supporting page rows before persist.
 * Uses raw _sheet cells so normalizeIntent defaults cannot hide blanks.
 */
function validateImportedPages(pages) {
  const errors = []
  const warnings = []
  ;(pages || []).forEach((page, idx) => {
    if (page?.rolling_placeholder) return

    const missing = []
    if (!sheetCell(page, 'Page Title (Title Tag Style)') && !String(page?.title ?? '').trim()) {
      missing.push('Page Title (Title Tag Style)')
    }
    if (!sheetCell(page, 'Suggested URL') && !page.url_path) missing.push('Suggested URL')
    if (!sheetCell(page, 'Section') && !page.section) missing.push('Section')
    if (!sheetCell(page, 'Cluster') && !page.cluster_raw) missing.push('Cluster')
    if (!sheetCell(page, 'Primary Query Cluster')) missing.push('Primary Query Cluster')
    if (!sheetCell(page, 'Search Intent')) missing.push('Search Intent')
    if (!sheetCell(page, 'Phase')) missing.push('Phase')
    if (requiresInternalLinks(page) && !sheetCell(page, 'Internal Links To')) {
      missing.push('Internal Links To')
    }

    const title = displayTitle(page)
    if (missing.length) {
      errors.push({ row: idx + 2, title, missing_columns: missing }) // +2 ≈ header + 1-index
    } else if (!sheetCell(page, 'Notes / Angle') && !page.notes) {
      warnings.push(`Row ${idx + 2} "${title}": Notes / Angle is blank`)
    }
  })
  return { ok: errors.length === 0, errors, warnings }
}

module.exports = { validateImportedPages, sheetCell, requiresInternalLinks, displayTitle }
