import { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY } from '@/lib/supabase'
import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth'
import { SUPPORTED_LOCALES } from '@/lib/translate'

export const maxDuration = 30

/**
 * POST /api/admin/reviews/[id]/translations/[locale]/publish
 * Flip a translation to status='published' and stamp published_at.
 *
 * Per V1 policy, ai_assisted translations with reviewed_at set can publish
 * directly. ai_full without reviewed_at is blocked by the DB trigger
 * (migration 004) — surface a clear error.
 *
 * Optional body: { unpublish: true } reverses to status='draft' and
 * clears published_at.
 */
export async function POST(request, { params }) {
  try {
    verifyAdmin(request)
    const { id, locale } = await params
    const body = await request.json().catch(() => ({}))
    const unpublish = body.unpublish === true

    if (!SUPPORTED_LOCALES.includes(locale)) {
      return Response.json(
        { error: `Unsupported locale '${locale}'. V1: ${SUPPORTED_LOCALES.join(', ')}` },
        { status: 400 }
      )
    }

    const now = new Date().toISOString()
    const update = unpublish
      ? { status: 'draft', published_at: null }
      : { status: 'published', published_at: now }

    const writeKey = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/review_translations?review_id=eq.${id}&locale=eq.${encodeURIComponent(locale)}&select=id,locale,slug,status,published_at,updated_at`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${writeKey}`,
          apikey: writeKey,
          Prefer: 'return=representation',
        },
        body: JSON.stringify(update),
      }
    )

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      // Surface the publish-gate trigger error in a useful way
      if (errText.includes('YMYL policy')) {
        return Response.json(
          {
            error: 'Cannot publish: translation needs human review before going live',
            hint: 'This translation is marked ai_full. Mark it ai_assisted with reviewed_at, or human_only after a real review.',
            detail: errText,
          },
          { status: 422 }
        )
      }
      return Response.json(
        { error: `Publish failed: ${res.status}`, detail: errText.slice(0, 500) },
        { status: 500 }
      )
    }

    const rows = await res.json()
    if (!Array.isArray(rows) || rows.length === 0) {
      return Response.json({ error: 'Translation not found' }, { status: 404 })
    }

    // ─── Fire-and-forget: re-sync master to Replit ─────────────────────
    // Publishing/unpublishing a translation changes the translations[] array
    // in the master's sync payload. Without this, the public cryptokiller.org
    // page won't reflect the new translation until someone manually clicks
    // "Sync to Live" on the master.
    //
    // We don't `await` this — if Replit is down or sync is slow, the user
    // still gets an instant response. Errors are logged but don't surface.
    //
    // Only fires for status='published' masters; an unpublished master can't
    // have translations live anyway.
    const adminSecret = process.env.ADMIN_SECRET
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL
      || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null)
    if (adminSecret && baseUrl) {
      fetch(`${baseUrl}/api/admin/reviews/${id}/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminSecret}`,
        },
        signal: AbortSignal.timeout(10_000),
      }).catch((e) => {
        console.warn('[translations/publish] master re-sync failed (non-fatal):', e.message)
      })
    }

    return Response.json({
      translation: rows[0],
      action: unpublish ? 'unpublished' : 'published',
      master_resync_triggered: !!(adminSecret && baseUrl),
    })
  } catch (error) {
    if (error.message?.includes('Unauthorized')) return unauthorizedResponse()
    return Response.json({ error: error.message }, { status: 500 })
  }
}
