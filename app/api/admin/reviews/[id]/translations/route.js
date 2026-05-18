import { supabaseRequest, SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY } from '@/lib/supabase'
import { verifyAdmin, unauthorizedResponse } from '@/lib/admin-auth'
import { translateReview, SUPPORTED_LOCALES } from '@/lib/translate'

// Translation is a 2-call GPT-5.4-mini pipeline; full_article alone can
// run 60-120s depending on length. 300s matches the reviews/generate budget.
export const maxDuration = 300

/**
 * GET /api/admin/reviews/[id]/translations
 * List existing translations for a review.
 * Returns: { translations: [{ locale, slug, status, updated_at, word_count, ... }] }
 */
export async function GET(request, { params }) {
  try {
    verifyAdmin(request)
    const { id } = await params

    const rows = await supabaseRequest(
      `/review_translations?review_id=eq.${id}&select=id,locale,slug,status,word_count,translation_method,translator_name,reviewed_at,ai_model,ai_prompt_version,published_at,source_review_updated_at,created_at,updated_at&order=locale.asc`
    )

    return Response.json({
      translations: Array.isArray(rows) ? rows : [],
      supported_locales: SUPPORTED_LOCALES,
    })
  } catch (error) {
    if (error.message?.includes('Unauthorized')) return unauthorizedResponse()
    return Response.json({ error: error.message }, { status: 500 })
  }
}

/**
 * POST /api/admin/reviews/[id]/translations
 * Create a new translation for a master review.
 * Body: { locale: 'it'|'es'|'de'|'fr'|'pt-BR', slug?: string }
 *
 * Reads the master review, runs the translation engine, INSERTs into
 * review_translations as 'draft' (or 'review_pending' if you want a
 * manual review step before publish). Returns the new translation row.
 */
export async function POST(request, { params }) {
  try {
    verifyAdmin(request)
    const { id } = await params
    const body = await request.json().catch(() => ({}))
    const { locale, slug: slugOverride } = body

    if (!locale || !SUPPORTED_LOCALES.includes(locale)) {
      return Response.json(
        { error: `locale required, one of: ${SUPPORTED_LOCALES.join(', ')}` },
        { status: 400 }
      )
    }

    // Fetch the master review
    const masterRows = await supabaseRequest(`/reviews?id=eq.${id}&select=*`)
    if (!Array.isArray(masterRows) || masterRows.length === 0) {
      return Response.json({ error: 'Review not found' }, { status: 404 })
    }
    const master = masterRows[0]

    // Reject self-translation (master is en — can't translate en→en)
    if ((master.locale || 'en') === locale) {
      return Response.json(
        { error: `Cannot create a ${locale} translation: master is already in ${locale}` },
        { status: 409 }
      )
    }

    // Reject duplicate
    const existing = await supabaseRequest(
      `/review_translations?review_id=eq.${id}&locale=eq.${encodeURIComponent(locale)}&select=id`
    )
    if (Array.isArray(existing) && existing.length > 0) {
      return Response.json(
        { error: `${locale} translation already exists for this review`, translation_id: existing[0].id },
        { status: 409 }
      )
    }

    // Run the translation engine — this is the slow part (30-120s typical)
    const payload = await translateReview(master, locale, {
      slug: slugOverride || master.slug,
    })

    // INSERT — use service role so RLS doesn't block
    const writeKey = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY
    const insertRes = await fetch(
      `${SUPABASE_URL}/rest/v1/review_translations?select=*`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${writeKey}`,
          apikey: writeKey,
          Prefer: 'return=representation',
        },
        body: JSON.stringify(payload),
      }
    )

    if (!insertRes.ok) {
      const errText = await insertRes.text().catch(() => '')
      // Surface helpful error for slug collision
      if (errText.includes('review_translations_locale_slug_key')) {
        return Response.json(
          {
            error: `Slug "${payload.slug}" already exists in locale "${locale}". Pick a different per-locale slug.`,
            hint: 'Override the slug via body.slug when calling this endpoint.',
          },
          { status: 409 }
        )
      }
      return Response.json(
        { error: `Supabase insert failed: ${insertRes.status}`, detail: errText.slice(0, 500) },
        { status: 500 }
      )
    }

    const inserted = await insertRes.json()
    const row = Array.isArray(inserted) ? inserted[0] : inserted

    return Response.json({
      translation: row,
      master: { id: master.id, slug: master.slug, locale: master.locale || 'en' },
    }, { status: 201 })
  } catch (error) {
    if (error.message?.includes('Unauthorized')) return unauthorizedResponse()
    console.error('[translations/create] error:', error.message)
    return Response.json({ error: error.message }, { status: 500 })
  }
}
