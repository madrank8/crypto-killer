'use strict'

const XLSX = require('xlsx')
const { looksLikePageMapHeaders, remapRowKeys, mapPageRow } = require('./field-map')

/**
 * Parse a CSV string into an array of objects keyed by header.
 * Handles quoted fields and escaped quotes.
 */
function parseCsvText(text) {
  const src = String(text || '').replace(/^\uFEFF/, '')
  if (!src.trim()) return { headers: [], rows: [] }

  const rows = []
  let i = 0
  const len = src.length

  function readCell() {
    if (src[i] === '"') {
      i += 1
      let out = ''
      while (i < len) {
        if (src[i] === '"') {
          if (src[i + 1] === '"') {
            out += '"'
            i += 2
            continue
          }
          i += 1
          break
        }
        out += src[i]
        i += 1
      }
      // Skip trailing whitespace until delimiter
      while (i < len && (src[i] === ' ' || src[i] === '\t')) i += 1
      if (src[i] === ',') i += 1
      return out
    }
    let out = ''
    while (i < len && src[i] !== ',' && src[i] !== '\n' && src[i] !== '\r') {
      out += src[i]
      i += 1
    }
    if (src[i] === ',') i += 1
    return out
  }

  function readRow() {
    if (i >= len) return null
    // Skip blank lines
    while (i < len && (src[i] === '\n' || src[i] === '\r')) i += 1
    if (i >= len) return null
    const cells = []
    while (i < len && src[i] !== '\n' && src[i] !== '\r') {
      cells.push(readCell())
    }
    while (i < len && (src[i] === '\n' || src[i] === '\r')) i += 1
    return cells
  }

  const headerCells = readRow()
  if (!headerCells) return { headers: [], rows: [] }
  const headers = headerCells.map((h) => String(h || '').trim())

  let cells
  while ((cells = readRow()) !== null) {
    if (cells.every((c) => !String(c || '').trim())) continue
    const obj = {}
    for (let c = 0; c < headers.length; c += 1) {
      obj[headers[c]] = cells[c] !== undefined ? cells[c] : ''
    }
    rows.push(obj)
  }

  return { headers, rows }
}

function sheetRowsFromWorkbook(workbook) {
  const candidates = []
  for (const name of workbook.SheetNames || []) {
    const sheet = workbook.Sheets[name]
    if (!sheet) continue
    const json = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false })
    if (!json.length) continue
    const headers = Object.keys(json[0] || {})
    candidates.push({ name, headers, rows: json })
  }
  return candidates
}

function pickPageMapTab(candidates) {
  for (const c of candidates) {
    if (looksLikePageMapHeaders(c.headers)) return c
  }
  // Also try remapped header check on first row keys
  for (const c of candidates) {
    if (!c.rows.length) continue
    const remapped = remapRowKeys(c.rows[0])
    if (looksLikePageMapHeaders(Object.keys(remapped))) {
      return { ...c, headers: Object.keys(remapped) }
    }
  }
  return null
}

/**
 * Parse Foundation-style key/value pairs into core_components when present.
 * Looks for sheets/tables with "Component" / "Value" or "Key" / "Value" columns.
 */
function extractFoundationComponents(candidates) {
  const out = {}
  for (const c of candidates) {
    const headers = (c.headers || []).map((h) => String(h).toLowerCase())
    const keyIdx = headers.findIndex((h) => /^(component|key|field|name)$/.test(h.trim()))
    const valIdx = headers.findIndex((h) => /^(value|content|description)$/.test(h.trim()))
    if (keyIdx < 0 || valIdx < 0) continue
    const keyH = c.headers[keyIdx]
    const valH = c.headers[valIdx]
    for (const row of c.rows) {
      const k = String(row[keyH] || '').trim()
      const v = String(row[valH] || '').trim()
      if (!k || !v) continue
      const slug = k.toLowerCase().replace(/[^a-z0-9]+/g, '_')
      out[slug] = v
    }
  }
  return Object.keys(out).length ? out : null
}

/**
 * Parse buffer (xlsx/csv) or CSV text into normalized page rows + metadata.
 */
function parseSheetInput({ buffer, csvText, filename } = {}) {
  const warnings = []
  let candidates = []

  if (buffer && Buffer.isBuffer(buffer) && buffer.length) {
    const lower = String(filename || '').toLowerCase()
    if (lower.endsWith('.csv') || (!lower.endsWith('.xlsx') && !lower.endsWith('.xls') && buffer.slice(0, 1).toString() !== 'P')) {
      // Try as CSV text first for .csv; also sniff if not zip (xlsx starts with PK)
      const asText = buffer.toString('utf8')
      if (lower.endsWith('.csv') || !buffer.slice(0, 2).equals(Buffer.from('PK'))) {
        const parsed = parseCsvText(asText)
        candidates.push({ name: filename || 'csv', headers: parsed.headers, rows: parsed.rows })
      }
    }
    if (!candidates.length || lower.endsWith('.xlsx') || lower.endsWith('.xls') || buffer.slice(0, 2).equals(Buffer.from('PK'))) {
      try {
        const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false })
        candidates = sheetRowsFromWorkbook(wb)
      } catch (e) {
        if (!candidates.length) throw new Error(`Failed to parse spreadsheet: ${e.message}`)
        warnings.push(`xlsx parse warning: ${e.message}`)
      }
    }
  } else if (csvText) {
    const parsed = parseCsvText(csvText)
    candidates.push({ name: 'csv', headers: parsed.headers, rows: parsed.rows })
  } else {
    throw new Error('No spreadsheet data provided')
  }

  const pageTab = pickPageMapTab(candidates)
  if (!pageTab) {
    throw new Error(
      'Could not find a page-map tab. Expected headers: Section, Cluster, Page Title, Suggested URL, Phase.'
    )
  }

  const pages = []
  let skipped = 0
  for (const raw of pageTab.rows) {
    const mapped = mapPageRow(raw)
    if (!mapped) {
      skipped += 1
      continue
    }
    pages.push(mapped)
  }

  if (!pages.length) throw new Error('Page-map tab had no usable rows')

  const foundation = extractFoundationComponents(
    candidates.filter((c) => c !== pageTab && /foundation|core.?component/i.test(c.name || ''))
  )

  return {
    pages,
    tab_name: pageTab.name,
    warnings: [
      ...warnings,
      ...(skipped ? [`Skipped ${skipped} empty/incomplete rows`] : []),
    ],
    core_components: foundation,
    source_meta: {
      tab: pageTab.name,
      row_count: pages.length,
      candidate_tabs: candidates.map((c) => c.name),
    },
  }
}

/**
 * Extract Google Spreadsheet ID from a sharing / edit URL.
 */
function extractSpreadsheetId(url) {
  const s = String(url || '').trim()
  const m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)
  if (m) return m[1]
  // bare id
  if (/^[a-zA-Z0-9-_]{20,}$/.test(s)) return s
  return null
}

/**
 * Fetch candidate CSV exports from a public Google Sheet.
 * Tries common gids plus the default sheet; picks the page-map by header signature.
 */
async function fetchGoogleSheetCsv(sheetUrl, { fetchImpl = fetch } = {}) {
  const id = extractSpreadsheetId(sheetUrl)
  if (!id) throw new Error('Invalid Google Sheet URL (could not extract spreadsheet id)')

  // Known Growth Partner page-map gid first, then a few defaults
  const gids = [
    '1063419045', // CryptoKiller page map
    '0',
    '1',
    '2',
  ]

  const warnings = []
  const attempts = []

  for (const gid of gids) {
    const url = `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&gid=${gid}`
    try {
      const res = await fetchImpl(url, {
        headers: { Accept: 'text/csv,*/*' },
        redirect: 'follow',
      })
      if (!res.ok) {
        warnings.push(`gid=${gid} HTTP ${res.status}`)
        continue
      }
      const text = await res.text()
      if (!text || /<!DOCTYPE html>|Sign in/i.test(text.slice(0, 200))) {
        warnings.push(`gid=${gid} returned HTML (sheet may not be public)`)
        continue
      }
      const parsed = parseCsvText(text)
      attempts.push({ name: `gid:${gid}`, headers: parsed.headers, rows: parsed.rows, csvText: text })
      if (looksLikePageMapHeaders(parsed.headers)) {
        return parseSheetInput({ csvText: text })
      }
    } catch (e) {
      warnings.push(`gid=${gid}: ${e.message}`)
    }
  }

  // Fallback: try xlsx export of the whole workbook
  try {
    const xlsxUrl = `https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`
    const res = await fetchImpl(xlsxUrl, { redirect: 'follow' })
    if (res.ok) {
      const ab = await res.arrayBuffer()
      const buffer = Buffer.from(ab)
      if (buffer.length > 100 && buffer.slice(0, 2).equals(Buffer.from('PK'))) {
        const result = parseSheetInput({ buffer, filename: 'sheet.xlsx' })
        result.warnings = [...(result.warnings || []), ...warnings]
        return result
      }
    } else {
      warnings.push(`xlsx export HTTP ${res.status}`)
    }
  } catch (e) {
    warnings.push(`xlsx export: ${e.message}`)
  }

  // Last chance: any attempt that remaps to page-map headers
  for (const a of attempts) {
    if (a.rows.length && looksLikePageMapHeaders(Object.keys(remapRowKeys(a.rows[0])))) {
      const result = parseSheetInput({ csvText: a.csvText })
      result.warnings = [...(result.warnings || []), ...warnings]
      return result
    }
  }

  throw new Error(
    `Could not load a page-map tab from Google Sheet. Make sure the sheet is shared as "Anyone with the link can view". ${warnings.slice(0, 3).join('; ')}`
  )
}

module.exports = {
  parseCsvText,
  parseSheetInput,
  extractSpreadsheetId,
  fetchGoogleSheetCsv,
  pickPageMapTab,
  looksLikePageMapHeaders,
}
