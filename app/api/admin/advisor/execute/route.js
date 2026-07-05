import { supabaseRequest } from '@/lib/supabase'
import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth'

export const maxDuration = 60

/**
 * POST /api/admin/advisor/execute
 * Body: { fingerprint }
 *
 * One-click execution of an advisor suggestion. Safety model:
 *  - The fingerprint is resolved against suggestions STORED in
 *    advisor_reports — the client cannot invent an action; only what a
 *    persisted report actually recommended can be executed.
 *  - Execution never publishes anything. It creates a draft and returns a
 *    redirect into the review editor with the relevant pipeline
 *    auto-started (?generate=auto / ?polish=auto), where progress is
 *    visible and the human remains the publish gate.
 *
 * Executable action types:
 *  - new_review      → create blank review for the brand → editor ?generate=auto
 *  - refresh_review  → editor ?polish=auto (visuals + audit + evidence + SEO fixes)
 *  - fix_ctr         → same as refresh (polish applies title/meta/AEO fixes)
 * Everything else returns { redirect: deep_link } (plain navigation).
 */

function normalizeSlug(target) {
  if (!target) return null
  // Accept "/review/foo", "review/foo", full URLs, or bare slugs
  const clean = String(target).trim().replace(/^https?:\/\/[^/]+/, '')
  const parts = clean.split('/').filter(Boolean)
  return (parts[parts.length - 1] || '').toLowerCase() || null
}

async function findSuggestion(fingerprint) {
  const reports = await supabaseRequest(
    '/advisor_reports?status=eq.complete&select=report&order=created_at.desc&limit=10',
    { useServiceRole: true }
  )
  for (const r of reports || []) {
    const match = (r.report?.suggestions || []).find((s) => s.fingerprint === fingerprint)
    if (match) return match
  }
  return null
}

export async function POST(request) {
  try {
    verifyAdmin(request)
  } catch {
    return unauthorizedResponse()
  }

  try {
    const { fingerprint } = await request.json()
    if (!fingerprint) return Response.json({ error: 'fingerprint required' }, { status: 400 })

    const suggestion = await findSuggestion(fingerprint)
    if (!suggestion) {
      return Response.json({ error: 'Suggestion not found in any stored report' }, { status: 404 })
    }

    const slug = normalizeSlug(suggestion.target)

    switch (suggestion.action_type) {
      case 'new_review': {
        if (!slug) return Response.json({ error: 'Suggestion has no brand target' }, { status: 400 })
        const brands = await supabaseRequest(
          `/scam_brands?slug=eq.${encodeURIComponent(slug)}&select=id,slug,name&limit=1`,
          { useServiceRole: true }
        )
        const brand = brands?.[0]
        if (!brand) {
          return Response.json({ error: `Brand '${slug}' not found`, redirect: suggestion.deep_link }, { status: 404 })
        }
        // Reuse the existing create route (single source of truth for
        // review scaffolding) via self-fetch with the caller's auth.
        const origin = new URL(request.url).origin
        const createRes = await fetch(`${origin}/api/admin/reviews/create`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: request.headers.get('authorization') || '',
          },
          body: JSON.stringify({ brand_id: brand.id }),
        })
        const created = await createRes.json()
        if (!createRes.ok) {
          return Response.json({ error: created.error || 'Create failed' }, { status: 500 })
        }
        return Response.json({
          ok: true,
          action: created.existing ? 'opened_existing_review' : 'created_review',
          redirect: `/admin/review/${created.review_id}?generate=auto`,
        })
      }

      case 'refresh_review':
      case 'fix_ctr': {
        if (!slug) return Response.json({ error: 'Suggestion has no review target', redirect: suggestion.deep_link }, { status: 400 })
        const reviews = await supabaseRequest(
          `/reviews?slug=eq.${encodeURIComponent(slug)}&select=id,slug&limit=1`,
          { useServiceRole: true }
        )
        const review = reviews?.[0]
        if (!review) {
          // fix_ctr targets can be search queries rather than slugs —
          // fall back to plain navigation.
          return Response.json({ ok: true, action: 'redirect_only', redirect: suggestion.deep_link })
        }
        return Response.json({
          ok: true,
          action: 'polish_started',
          redirect: `/admin/review/${review.id}?polish=auto`,
        })
      }

      default:
        return Response.json({ ok: true, action: 'redirect_only', redirect: suggestion.deep_link })
    }
  } catch (err) {
    console.error('[advisor/execute]', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
