import { supabaseRequest, SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY } from '@/lib/supabase'
import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth'
import { SUPPORTED_LOCALES } from '@/lib/translate'

export const maxDuration = 60

// Per-locale slug format. Same regex as the POST creator — lowercase
// letters/digits/hyphens, starting with alphanumeric, 1-100 chars. Rejects
// '/', '?', '#', whitespace, uppercase that would break routing.
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,99}$/

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

    // useServiceRole: admin editor must see drafts; anon RLS hides them.
    const rows = await supabaseRequest(
      `/review_translations?review_id=eq.${id}&locale=eq.${encodeURIComponent(locale)}&select=*`,
      { useServiceRole: true }
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

    // Reject unsupported locales explicitly. Without this, PATCH silently
    // no-ops (PostgREST returns 200 with empty array) for invalid locales,
    // hiding bugs in caller code.
    if (!SUPPORTED_LOCALES.includes(locale)) {
      return Response.json(
        { error: `Unsupported locale '${locale}'. V1: ${SUPPORTED_LOCALES.join(', ')}` },
        { status: 400 }
      )
    }

    const body = await request.json().catch(() => ({}))
    const update = pickEditableFields(body)

    if (Object.keys(update).length === 0 && body.markHumanReviewed !== true) {
      return Response.json({ error: 'No editable fields in body' }, { status: 400 })
    }

    // Validate slug if caller is editing it — same rule as the POST creator.
    if (update.slug != null && !SLUG_RE.test(update.slug)) {
      return Response.json(
        {
          error: `slug "${String(update.slug).slice(0, 80)}" is invalid. Must be lowercase letters/digits/hyphens, 1-100 chars, starting with a letter or digit.`,
        },
        { status: 400 }
      )
    }

    // If the editor explicitly marks human-only review, bump translation_method
    // and reviewed_at. Require translator_name to be set to a real reviewer
    // (not the default editorial team) — otherwise the YMYL provenance signal
    // this column exists for is defeated. The actual name can come from the
    // same PATCH body (allowlisted) or from a prior PATCH that set it.
    if (body.markHumanReviewed === true) {
      // Resolve the translator_name that WILL be on the row after this PATCH:
      // either from update (if included) or from the existing row.
      let effectiveName = (update.translator_name || '').trim()
      if (!effectiveName) {
        // useServiceRole: existing row may be in draft state; anon RLS would
        // hide it and we'd wrongly fall through to the "missing name" branch.
        const existing = await supabaseRequest(
          `/review_translations?review_id=eq.${encodeURIComponent(id)}&locale=eq.${encodeURIComponent(locale)}&select=translator_name`,
          { useServiceRole: true }
        )
        effectiveName = ((Array.isArray(existing) ? existing[0]?.translator_name : '') || '').trim()
      }
      if (!effectiveName || effectiveName === 'Crypto Killer Editorial Team') {
        return Response.json(
          {
            error: 'markHumanReviewed requires translator_name to be set to the actual reviewer (not the default editorial team).',
            hint: 'Include translator_name in this PATCH body, or PATCH translator_name first, then PATCH markHumanReviewed=true.',
          },
          { status: 400 }
        )
      }
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
    // PostgREST returns an array; empty means no row matched the filter.
    // Surface that as a real 404 rather than `{ translation: undefined }`.
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
 * DELETE /api/admin/reviews/[id]/translations/[locale]
 * Hard-delete the translation row.
 */
export async function DELETE(request, { params }) {
  try {
    verifyAdmin(request)
    const { id, locale } = await params

    // Same locale validation as PATCH/GET — silently no-op for invalid
    // locale codes hides bugs in caller code.
    if (!SUPPORTED_LOCALES.includes(locale)) {
      return Response.json(
        { error: `Unsupported locale '${locale}'. V1: ${SUPPORTED_LOCALES.join(', ')}` },
        { status: 400 }
      )
    }

    const writeKey = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY
    // Prefer: return=representation so we know whether anything was actually
    // deleted (PostgREST returns the deleted rows). Without this we can't
    // distinguish "deleted 1 row" from "deleted 0 rows because nothing matched".
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/review_translations?review_id=eq.${encodeURIComponent(id)}&locale=eq.${encodeURIComponent(locale)}&select=id`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${writeKey}`,
          apikey: writeKey,
          Prefer: 'return=representation',
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

    const deleted = await res.json().catch(() => [])
    if (!Array.isArray(deleted) || deleted.length === 0) {
      return Response.json({ error: 'Translation not found' }, { status: 404 })
    }

    return Response.json({ success: true, deleted_id: deleted[0]?.id })
  } catch (error) {
    if (error.message?.includes('Unauthorized')) return unauthorizedResponse()
    return Response.json({ error: error.message }, { status: 500 })
  }
}
