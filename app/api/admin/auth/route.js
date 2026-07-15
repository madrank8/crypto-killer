import crypto from 'crypto'
import { issueSessionToken } from '@/lib/admin-auth'

/**
 * POST /api/admin/auth
 * Validate admin password and return a signed, expiring session token.
 */
export async function POST(request) {
  try {
    const { password } = await request.json()
    const adminSecret = process.env.ADMIN_SECRET

    if (!adminSecret) {
      return Response.json(
        { error: 'ADMIN_SECRET not configured' },
        { status: 500 }
      )
    }

    // Constant-time password check.
    const a = crypto.createHash('sha256').update(String(password || '')).digest()
    const b = crypto.createHash('sha256').update(String(adminSecret)).digest()
    if (!crypto.timingSafeEqual(a, b)) {
      return Response.json(
        { error: 'Invalid password' },
        { status: 401 }
      )
    }

    // Return a signed session token — the raw ADMIN_SECRET never reaches the
    // browser, and the token self-expires (12h). verifyAdmin still accepts the
    // raw secret for machine callers, so this is fully backward compatible.
    return Response.json({ token: issueSessionToken() })
  } catch (error) {
    return Response.json(
      { error: 'Authentication failed' },
      { status: 500 }
    )
  }
}
