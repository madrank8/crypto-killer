/**
 * POST /api/admin/auth
 * Validate admin password and return token
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

    if (password !== adminSecret) {
      return Response.json(
        { error: 'Invalid password' },
        { status: 401 }
      )
    }

    // Return the secret as the token (simple approach for solo operator)
    return Response.json({ token: adminSecret })
  } catch (error) {
    return Response.json(
      { error: 'Authentication failed' },
      { status: 500 }
    )
  }
}
