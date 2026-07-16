/**
 * Admin authentication helper for API routes.
 *
 * Two accepted credentials, checked in constant time:
 *   1. A signed, expiring session token minted by the login route
 *      (issueSessionToken) — this is what the browser holds. The raw
 *      ADMIN_SECRET is never sent to the client.
 *   2. The raw ADMIN_SECRET itself — retained for machine/manual callers
 *      (curl, scripts) and backward compatibility, so tightening the browser
 *      path can never lock anyone out.
 */

import crypto from 'crypto'

const ADMIN_SECRET = process.env.ADMIN_SECRET || ''

// Session-token lifetime. Long enough not to interrupt an editing session,
// short enough that an exfiltrated token expires on its own.
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7d — long enough to avoid mid-session expiry
const TOKEN_PREFIX = 'cks1' // crypto-killer session, v1

function timingEqual(a, b) {
  // timingSafeEqual throws on length mismatch — hash to equal length first so
  // the comparison itself stays constant-time regardless of input lengths.
  const ah = crypto.createHash('sha256').update(String(a)).digest()
  const bh = crypto.createHash('sha256').update(String(b)).digest()
  return crypto.timingSafeEqual(ah, bh)
}

function sign(payload) {
  return crypto.createHmac('sha256', ADMIN_SECRET).update(payload).digest('hex')
}

/**
 * Mint a signed session token: `cks1.<expiryMs>.<hmac>`. The HMAC key is
 * ADMIN_SECRET, so the token is verifiable server-side without any store, but
 * the raw secret never leaves the server.
 */
function issueSessionToken(ttlMs = SESSION_TTL_MS) {
  if (!ADMIN_SECRET) throw new Error('ADMIN_SECRET environment variable not configured')
  const exp = Date.now() + ttlMs
  const payload = `${TOKEN_PREFIX}.${exp}`
  return `${payload}.${sign(payload)}`
}

/**
 * Validate a signed session token. True only if the signature matches and the
 * token has not expired.
 */
function verifySessionToken(token) {
  if (typeof token !== 'string') return false
  const parts = token.split('.')
  if (parts.length !== 3) return false
  const [prefix, expStr, mac] = parts
  if (prefix !== TOKEN_PREFIX) return false
  const exp = Number(expStr)
  if (!Number.isFinite(exp) || Date.now() > exp) return false
  return timingEqual(mac, sign(`${prefix}.${expStr}`))
}

/**
 * Verify admin credentials from the request Authorization header.
 * Accepts either a valid session token or the raw ADMIN_SECRET.
 * @throws {Error} if ADMIN_SECRET is unconfigured or the credential is invalid.
 */
function verifyAdmin(request) {
  if (!ADMIN_SECRET) {
    throw new Error('ADMIN_SECRET environment variable not configured')
  }

  const authHeader = request.headers.get('Authorization') || ''
  const [scheme, token] = authHeader.split(' ')

  if (scheme !== 'Bearer' || !token) {
    throw new Error('Unauthorized: invalid or missing admin token')
  }

  // Session token (preferred) or raw secret (machine callers / backward compat).
  if (verifySessionToken(token) || timingEqual(token, ADMIN_SECRET)) {
    return true
  }

  throw new Error('Unauthorized: invalid or missing admin token')
}

/**
 * Generate unauthorized JSON response
 * @returns {Response} - 401 JSON response
 */
function unauthorizedResponse() {
  return new Response(
    JSON.stringify({ error: 'Unauthorized' }),
    {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    }
  )
}

export { verifyAdmin, unauthorizedResponse, issueSessionToken, verifySessionToken }
