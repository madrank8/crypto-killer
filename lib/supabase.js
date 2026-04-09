const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

/**
 * Make a request to Supabase REST API
 */
async function supabaseRequest(path, options = {}) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('Missing Supabase environment variables')
  }
  const url = `${SUPABASE_URL}/rest/v1${path}`

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    apikey: SUPABASE_ANON_KEY,
    ...options.headers,
  }

  const response = await fetch(url, {
    ...options,
    headers,
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Supabase error: ${response.status} - ${error}`)
  }

  // Handle empty responses (e.g. 204 No Content from Prefer: return=minimal)
  const text = await response.text()
  if (!text) return null
  return JSON.parse(text)
}

/**
 * Fetch all rows from a table, paginating through Supabase's 1000-row limit.
 * @param {string} table - PostgREST path, e.g. '/scam_brands'
 * @param {string} select - Comma-separated column list
 * @param {number} pageSize - Rows per page (max 1000)
 * @returns {Promise<Array>} All rows concatenated
 */
async function fetchAllRows(table, select = '*', pageSize = 1000) {
  let allRows = []
  let offset = 0
  let hasMore = true

  while (hasMore) {
    const separator = table.includes('?') ? '&' : '?'
    const path = `${table}${separator}select=${select}&limit=${pageSize}&offset=${offset}`
    const rows = await supabaseRequest(path, {
      headers: { Prefer: 'count=exact' },
    })

    if (!rows || rows.length === 0) {
      hasMore = false
    } else {
      allRows = allRows.concat(rows)
      offset += rows.length
      if (rows.length < pageSize) {
        hasMore = false
      }
    }
  }

  return allRows
}

// Alias for content routes that import as supaFetch
const supaFetch = supabaseRequest

export { supabaseRequest, supaFetch, fetchAllRows, SUPABASE_URL, SUPABASE_ANON_KEY }
