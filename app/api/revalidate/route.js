import { revalidatePath } from 'next/cache'
import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth'

/**
 * POST /api/revalidate
 * On-demand ISR cache purge.
 *
 * Body: { paths: ["/review/senvix", "/", "/scams"] }
 *       or { path: "/review/senvix" }
 *
 * Requires admin Bearer token.
 */
export async function POST(request) {
  try {
    verifyAdmin(request)

    const body = await request.json()
    const paths = body.paths || (body.path ? [body.path] : [])

    if (paths.length === 0) {
      return Response.json(
        { error: 'Provide "path" (string) or "paths" (array)' },
        { status: 400 }
      )
    }

    const results = []
    for (const p of paths) {
      try {
        revalidatePath(p)
        results.push({ path: p, revalidated: true })
      } catch (err) {
        results.push({ path: p, revalidated: false, error: err.message })
      }
    }

    return Response.json({ success: true, results })
  } catch (error) {
    if (error.message?.includes('Unauthorized')) {
      return unauthorizedResponse()
    }
    return Response.json({ error: error.message }, { status: 500 })
  }
}
