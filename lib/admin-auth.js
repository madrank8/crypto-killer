/**
 * Admin authentication helper for API routes
 */

const ADMIN_SECRET = process.env.ADMIN_SECRET || ''

/**
 * Verify admin credentials from request Authorization header
 * @param {Request} request - Next.js request object
 * @returns {boolean} - True if authorization is valid
 * @throws {Error} - If ADMIN_SECRET is not configured or header is invalid
 */
function verifyAdmin(request) {
  if (!ADMIN_SECRET) {
    throw new Error('ADMIN_SECRET environment variable not configured')
  }

  const authHeader = request.headers.get('Authorization') || ''
  const [scheme, token] = authHeader.split(' ')

  if (scheme !== 'Bearer' || token !== ADMIN_SECRET) {
    throw new Error('Unauthorized: invalid or missing admin token')
  }

  return true
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

export { verifyAdmin, unauthorizedResponse }
