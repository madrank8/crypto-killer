const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

/**
 * Enhanced Supabase REST API client
 * Handles: GET, POST, PATCH, HEAD, RPC calls
 * Supports: Prefer headers, return=minimal, count=exact, text body parsing
 */
async function supaFetch(path, options = {}) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('Missing Supabase environment variables')
  }

  const url = `${SUPABASE_URL}/rest/v1${path}`
  const method = options.method || 'GET'

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    apikey: SUPABASE_ANON_KEY,
    ...(options.headers || {}),
  }

  const res = await fetch(url, { method, headers, body: options.body })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Supabase ${res.status}: ${text}`)
  }

  // HEAD requests — return count from content-range header
  if (method === 'HEAD') {
    const range = res.headers.get('content-range')
    const total = range ? parseInt((range.match(/\/(\d+)$/) || [])[1], 10) || null : null
    return { data: null, count: total }
  }

  // Prefer: return=minimal — no body expected
  const prefer = headers.Prefer || ''
  if (prefer.includes('return=minimal')) return null

  // Parse response body
  const text = await res.text()
  if (!text) return null

  const data = JSON.parse(text)

  // If count=exact was requested, extract total from content-range
  if (prefer.includes('count=exact')) {
    const range = res.headers.get('content-range')
    const total = range ? parseInt((range.match(/\/(\d+)$/) || [])[1], 10) || null : null
    return { data, count: total }
  }

  return data
}

/**
 * Fetch all rows with automatic pagination
 */
async function fetchAllRows(basePath, selectFields, pageSize = 1000) {
  const allRows = []
  let offset = 0
  while (true) {
    const sep = basePath.includes('?') ? '&' : '?'
    const data = await supaFetch(
      `${basePath}${sep}select=${selectFields}&limit=${pageSize}&offset=${offset}`
    )
    if (!data || data.length === 0) break
    allRows.push(...data)
    if (data.length < pageSize) break
    offset += pageSize
  }
  return allRows
}

// Backward-compatible alias
const supabaseRequest = supaFetch

export { supaFetch, supabaseRequest, fetchAllRows, SUPABASE_URL, SUPABASE_ANON_KEY }
