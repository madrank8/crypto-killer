'use strict'

function sheetCell(page, header) {
  const s = page?._sheet || {}
  return String(s[header] ?? '').trim()
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
    if (!page?.title) return

    const missing = []
    if (!sheetCell(page, 'Page Title (Title Tag Style)') && !page.title) missing.push('Page Title (Title Tag Style)')
    if (!sheetCell(page, 'Suggested URL') && !page.url_path) missing.push('Suggested URL')
    if (!sheetCell(page, 'Section') && !page.section) missing.push('Section')
    if (!sheetCell(page, 'Cluster') && !page.cluster_raw) missing.push('Cluster')
    if (!sheetCell(page, 'Primary Query Cluster')) missing.push('Primary Query Cluster')
    if (!sheetCell(page, 'Search Intent')) missing.push('Search Intent')
    if (!sheetCell(page, 'Phase')) missing.push('Phase')
    if (!sheetCell(page, 'Internal Links To')) missing.push('Internal Links To')

    if (missing.length) {
      errors.push({ row: idx + 2, title: page.title, missing_columns: missing }) // +2 ≈ header + 1-index
    } else if (!sheetCell(page, 'Notes / Angle') && !page.notes) {
      warnings.push(`Row ${idx + 2} "${page.title}": Notes / Angle is blank`)
    }
  })
  return { ok: errors.length === 0, errors, warnings }
}

module.exports = { validateImportedPages, sheetCell }
