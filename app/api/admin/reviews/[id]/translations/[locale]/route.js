import { supabaseRequest, SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY } from '@/lib/supabase'
import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth'
import { SUPPORTED_LOCALES } from '@/lib/translate'

export const maxDuration = 60

// Field allowlist for PATCH — protects against client setting provenance/
// status fields directly. Status changes go through the dedicated /publish
// endpoint. Provenance fields (translation_method, ai_model, reviewed_at,
// etc.) can only be updated through specific dedicated paths.
const EDITABLE_FIELDS = new Set([
  'title',
  'meta_description',
  'headline',
  'alternative_headline',
  'summary',
  'how_it_works',
  'verdict',
  'full_article',
  'red_flags',
  'faq',
  'key_takeaways',
  'not_for_you',
  'protection_steps',
  'methodology',
  'disclaimer',
  'expertise_depth',
  'slug',
  // Manual review-mark fields — promoting to human_only requires both:
  'translator_name',
  'translator_credentials',
])

function pickEditableFields(body) {
  const out = {}
  for (const k of Object.keys(body || {})) {
    if (EDITABLE_FIELDS.has(k)) out[k] = body[k]
  }
  return out
}

/**
 * GET /api/admin/reviews/[id]/translations/[locale]
 * Fetch the full translation row for editing.
 */
export async function GET(request, { params }) {
  try {
    verifyAdmin(request)
    const { id, locale } = await params

    if (!SUPPORTED_LOCALES.includes(locale)) {
      return Response.json(
        { error: `Unsupported locale '${locale}'. V1: ${SUPPORTED_LOCALES.join(', ')}` },
        { status: 400 }
      )
    }

    const rows = await supabaseRequest(
      `/review_translations?review_id=eq.${id}&locale=eq.${encodeURIComponent(locale)}&select=*`
    )
    if (!Array.isArray(rows) || rows.length === 0) {
      return Response.json({ error: 'Translation not found' }, { status: 404 })
    }

    return Response.json({ translation: rows[0] })
  } catch (error) {
    if (error.message?.includes('Unauthorized')) return unauthorizedResponse()
    return Response.json({ error: error.message }, { status: 500 })
  }
}

/**
 * PATCH /api/admin/reviews/[id]/translations/[locale]
 * Update editable fields. Status/provenance changes go through dedicated routes.
 */
export async function PATCH(request, { params }) {
  try {
    verifyAdmin(request)
    const { id, locale } = await params
    const body = await request.json().catch(() => ({}))
    const update = pickEditableFields(body)

    if (Object.keys(update).length === 0) {
      return Response.json({ error: 'No editable fields in body' }, { status: 400 })
    }

    // If the editor explicitly marks human-only review (translator_name +
    // translator_credentials set together), bump translation_method.
    if (body.markHumanReviewed === true) {
      update.translation_method = 'human_only'
      update.reviewed_at = new Date().toISOString()
    }

    const writeKey = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/review_translations?review_id=eq.${id}&locale=eq.${encodeURIComponent(locale)}&select=*`,
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
      if (errText.includes('review_translations_locale_slug_key')) {
        return Response.json(
          { error: `Slug "${update.slug}" already exists for locale "${locale}". Pick a different slug.` },
          { status: 409 }
        )
      }
      return Response.json(
        { error: `Update failed: ${res.status}`, detail: errText.slice(0, 500) },
        { status: 500 }
      )
    }

    const rows = await res.json()
    return Response.json({ translation: Array.isArray(rows) ? rows[0] : rows })
  } catch (error) {
    if (error.message?.includes('Unauthorized')) return unauthorizedResponse()
    return Response.json({ error: error.message }, { status: 500 })
  }
}

/**
 * DELETE /api/admin/reviews/[id]/translations/[locale]
 * Hard-delete the translation row.
 */
export async function DELETE(request, { params }) {
  try {
    verifyAdmin(request)
    const { id, locale } = await params

    const writeKey = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/review_translations?review_id=eq.${id}&locale=eq.${encodeURIComponent(locale)}`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${writeKey}`,
          apikey: writeKey,
          Prefer: 'return=minimal',
        },
      }
    )

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      return Response.json(
        { error: `Delete failed: ${res.status}`, detail: errText.slice(0, 500) },
        { status: 500 }
      )
    }

    return Response.json({ success: true })
  } catch (error) {
    if (error.message?.includes('Unauthorized')) return unauthorizedResponse()
    return Response.json({ error: error.message }, { status: 500 })
  }
}
