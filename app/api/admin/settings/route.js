import { supabaseRequest } from '@/lib/supabase'
import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth'

const SPYOWL_API = 'https://api.spyowl.icu'

/** Build full Cookie header from a raw token value or full cookie string */
function buildCookieHeader(raw) {
  if (!raw) return ''
  const trimmed = raw.trim()
  // If it already contains '=' it's a full cookie string — use as-is
  if (trimmed.includes('=')) return trimmed
  // Otherwise it's just the raw token value — prepend the cookie name
  return `__Secure-spyowl.session_token=${trimmed}`
}

/**
 * GET /api/admin/settings
 * Returns settings + SpyOwl cookie health status
 */
export async function GET(request) {
  try {
    verifyAdmin(request)
  } catch {
    return unauthorizedResponse()
  }

  try {
    const rows = await supabaseRequest('/settings?select=key,value,updated_at')
    const settings = {}
    for (const row of (Array.isArray(rows) ? rows : [])) {
      settings[row.key] = { value: row.value, updated_at: row.updated_at }
    }

    // Check SpyOwl cookie health
    const rawToken = settings.spyowl_cookie?.value || ''
    const cookieHeader = buildCookieHeader(rawToken)
    let spyowlStatus = { ok: false, message: 'No token set' }
    if (cookieHeader) {
      try {
        const res = await fetch(`${SPYOWL_API}/user/me`, {
          headers: { 'Cookie': cookieHeader },
        })
        if (res.ok) {
          const user = await res.json().catch(() => ({}))
          spyowlStatus = { ok: true, message: `Authenticated as ${user.email || 'unknown'}`, email: user.email }
        } else {
          spyowlStatus = { ok: false, message: `Auth failed (${res.status}) — token expired` }
        }
      } catch (e) {
        spyowlStatus = { ok: false, message: `Connection error: ${e.message}` }
      }
    }

    return Response.json({
      spyowl_cookie: {
        set: !!rawToken,
        length: rawToken.length,
        updated_at: settings.spyowl_cookie?.updated_at,
        status: spyowlStatus,
      },
    })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

/**
 * POST /api/admin/settings
 * Update a setting. Body: { key, value }
 */
export async function POST(request) {
  try {
    verifyAdmin(request)
  } catch {
    return unauthorizedResponse()
  }

  try {
    const { key, value } = await request.json()
    if (!key || typeof value !== 'string') {
      return Response.json({ error: 'key and value required' }, { status: 400 })
    }

    // Only allow known keys
    const allowedKeys = ['spyowl_cookie']
    if (!allowedKeys.includes(key)) {
      return Response.json({ error: `Unknown setting: ${key}` }, { status: 400 })
    }

    // Upsert into settings table
    await supabaseRequest('/settings', {
      method: 'POST',
      headers: {
        'Prefer': 'resolution=merge-duplicates',
      },
      body: JSON.stringify({
        key,
        value: value.trim(),
        updated_at: new Date().toISOString(),
      }),
    })

    // If SpyOwl cookie, verify it immediately
    let verification = null
    if (key === 'spyowl_cookie' && value.trim()) {
      const cookieHeader = buildCookieHeader(value.trim())
      try {
        const res = await fetch(`${SPYOWL_API}/user/me`, {
          headers: { 'Cookie': cookieHeader },
        })
        if (res.ok) {
          const user = await res.json().catch(() => ({}))
          verification = { ok: true, message: `Authenticated as ${user.email || 'unknown'}` }
        } else {
          verification = { ok: false, message: `Auth failed (${res.status}) — check token` }
        }
      } catch (e) {
        verification = { ok: false, message: `Connection error: ${e.message}` }
      }
    }

    return Response.json({ success: true, verification })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
