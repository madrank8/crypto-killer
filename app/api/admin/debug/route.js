import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth'

/**
 * GET /api/admin/debug
 * Quick diagnostic: check env vars needed for evidence grid
 */
export async function GET(request) {
  try {
    verifyAdmin(request)
  } catch {
    return unauthorizedResponse()
  }

  const SPYOWL_COOKIE = process.env.SPYOWL_COOKIE || ''
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || ''
  const ADMIN_SECRET = process.env.ADMIN_SECRET || ''

  const result = {
    spyowl_cookie: {
      set: !!SPYOWL_COOKIE,
      length: SPYOWL_COOKIE.length,
      prefix: SPYOWL_COOKIE ? SPYOWL_COOKIE.substring(0, 30) + '...' : 'EMPTY',
    },
    anthropic_key: {
      set: !!ANTHROPIC_API_KEY,
      length: ANTHROPIC_API_KEY.length,
    },
    admin_secret: {
      set: !!ADMIN_SECRET,
      length: ADMIN_SECRET.length,
    },
  }

  // Test SpyOwl auth if cookie exists
  if (SPYOWL_COOKIE) {
    try {
      const authCheck = await fetch('https://api.spyowl.icu/user/me', {
        headers: { 'Cookie': SPYOWL_COOKIE },
      })
      result.spyowl_auth = {
        status: authCheck.status,
        ok: authCheck.ok,
      }
    } catch (e) {
      result.spyowl_auth = { error: e.message }
    }
  }

  return Response.json(result)
}
