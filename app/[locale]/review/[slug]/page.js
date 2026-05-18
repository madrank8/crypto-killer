/**
 * Localized review preview — admin-only preview on the Vercel host.
 *
 * Production rendering of /it/review/<slug>, /es/review/<slug>, etc. happens
 * on the cryptokiller.org Replit deployment, which reads the same
 * review_translations rows from Supabase. This Vercel route exists so admins
 * can preview translations after creating/editing them WITHOUT waiting for a
 * Replit deploy.
 *
 * Therefore this page:
 *   - emits canonical pointing at cryptokiller.org (production canonical, not Vercel)
 *   - sets robots: noindex (the Vercel preview must never compete with prod in search)
 *   - emits hreflang link alternates so the SEO scaffolding is testable
 *   - is a deliberately minimal renderer (no visuals, no sidebar widgets); the
 *     full Replit page handles that
 */

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { supabaseRequest } from '@/lib/supabase'

export const revalidate = 60
export const dynamicParams = true

// V1 locales — must match lib/translate.js SUPPORTED_LOCALES and the
// review_translations.locale CHECK constraint.
//
// URL form is lowercase ('pt-br') for consistency; DB form is BCP-47 canonical
// ('pt-BR'). Normalize both directions in this module.
const URL_LOCALES = new Set(['it', 'es', 'de', 'fr', 'pt-br'])
const URL_TO_DB = { 'it': 'it', 'es': 'es', 'de': 'de', 'fr': 'fr', 'pt-br': 'pt-BR' }
const URL_TO_BCP47 = { 'it': 'it-IT', 'es': 'es-ES', 'de': 'de-DE', 'fr': 'fr-FR', 'pt-br': 'pt-BR' }
const ALL_HREFLANG = ['en', 'it', 'es', 'de', 'fr', 'pt-BR']

const PROD_SITE_URL = 'https://cryptokiller.org'

function normalizeLocale(rawUrl) {
  if (!rawUrl) return null
  const lower = String(rawUrl).toLowerCase()
  if (!URL_LOCALES.has(lower)) return null
  return { url: lower, db: URL_TO_DB[lower], bcp47: URL_TO_BCP47[lower] }
}

function prodUrl(localeUrlSeg, slug) {
  if (!localeUrlSeg) return `${PROD_SITE_URL}/review/${slug}` // EN
  return `${PROD_SITE_URL}/${localeUrlSeg}/review/${slug}`
}

// ─── Metadata ────────────────────────────────────────────────────────────
//
// Emits canonical pointing at the cryptokiller.org production URL (NOT this
// Vercel preview), hreflang link alternates for every published translation
// sibling, and noindex so the preview never gets indexed by Googlebot.

export async function generateMetadata({ params }) {
  const { locale: rawLocale, slug } = await params
  const loc = normalizeLocale(rawLocale)
  if (!loc) return { title: 'Not found', robots: { index: false, follow: false } }

  // Admin preview: don't require status=published — show drafts too. This is
  // a noindexed Vercel preview, never a production page; admins WANT to
  // preview drafts before publishing. useServiceRole bypasses anon RLS
  // (which only shows published rows).
  const transRows = await supabaseRequest(
    `/review_translations?locale=eq.${encodeURIComponent(loc.db)}&slug=eq.${encodeURIComponent(slug)}&select=title,meta_description,review_id,slug,status`,
    { useServiceRole: true }
  )

  if (!Array.isArray(transRows) || transRows.length === 0) {
    return { title: 'Translation not found', robots: { index: false, follow: false } }
  }
  const trans = transRows[0]

  // Pull published siblings (for hreflang) + master slug in parallel
  const [allTrans, masterRows] = await Promise.all([
    supabaseRequest(
      `/review_translations?review_id=eq.${trans.review_id}&status=eq.published&select=locale,slug`
    ),
    supabaseRequest(
      `/reviews?id=eq.${trans.review_id}&select=slug`
    ),
  ])
  const masterSlug = Array.isArray(masterRows) && masterRows[0]?.slug

  const alternates = { languages: {} }
  // EN master (use bare slug)
  if (masterSlug) {
    alternates.languages['en'] = prodUrl(null, masterSlug)
    alternates.languages['x-default'] = prodUrl(null, masterSlug)
  }
  // Every other published translation
  for (const t of allTrans || []) {
    const segUrl = t.locale === 'pt-BR' ? 'pt-br' : t.locale
    alternates.languages[t.locale] = prodUrl(segUrl, t.slug)
  }

  return {
    title: trans.title || 'Review',
    description: trans.meta_description || '',
    // Canonical = production URL on cryptokiller.org, NOT this Vercel preview.
    // The Vercel preview is admin-only; production rendering lives on Replit.
    alternates: {
      canonical: prodUrl(loc.url, slug),
      ...alternates,
    },
    // Never let this preview into Google's index — it would compete with
    // the real cryptokiller.org/{locale}/review/{slug}.
    robots: { index: false, follow: false, googleBot: { index: false, follow: false } },
    other: {
      // Belt-and-suspenders — also tag with notranslate so Google doesn't
      // serve a machine-translated preview of an already-translated page.
      googlebot: 'noindex, nofollow, notranslate',
    },
  }
}

// ─── Page render ─────────────────────────────────────────────────────────

export default async function LocaleReviewPreview({ params }) {
  const { locale: rawLocale, slug } = await params
  const loc = normalizeLocale(rawLocale)
  if (!loc) notFound()

  // Fetch the translation first — we need review_id before we can fetch master.
  // useServiceRole so the admin preview can render drafts (anon RLS hides them).
  const transRows = await supabaseRequest(
    `/review_translations?locale=eq.${encodeURIComponent(loc.db)}&slug=eq.${encodeURIComponent(slug)}&select=*`,
    { useServiceRole: true }
  )
  if (!Array.isArray(transRows) || transRows.length === 0) notFound()
  const trans = transRows[0]

  // Master + brand in parallel via a single master query.
  const masterRows = await supabaseRequest(
    `/reviews?id=eq.${trans.review_id}&select=*`
  )
  const master = Array.isArray(masterRows) && masterRows[0]
  if (!master) notFound()

  let brand = null
  if (master.brand_id) {
    const brandRows = await supabaseRequest(
      `/scam_brands?id=eq.${master.brand_id}&select=id,name,slug`
    )
    brand = Array.isArray(brandRows) && brandRows[0]
  }

  const langLabel = {
    'it': 'Italiano', 'es': 'Español', 'de': 'Deutsch', 'fr': 'Français', 'pt-br': 'Português (Brasil)',
  }[loc.url]

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100" lang={loc.bcp47}>
      {/* Admin preview banner */}
      <div className="bg-amber-950/70 border-b border-amber-700/40 text-amber-200 text-xs px-4 py-2 text-center">
        <strong>Admin preview ({langLabel}).</strong>{' '}
        Production renders at{' '}
        <a
          href={`https://cryptokiller.org/${loc.url}/review/${slug}`}
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-amber-100"
        >
          cryptokiller.org/{loc.url}/review/{slug}
        </a>
        . This Vercel page is <code>noindex</code>.
      </div>

      <article className="max-w-3xl mx-auto px-4 py-12 space-y-8">
        <header className="space-y-3 border-b border-slate-800 pb-6">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Link href="/admin/brands" className="hover:text-slate-300">← Admin</Link>
            <span>·</span>
            <span>{brand?.name || master.title}</span>
            <span>·</span>
            <span className="uppercase font-mono">{loc.bcp47}</span>
            <span>·</span>
            <span className={`px-1.5 py-0.5 rounded ${
              trans.status === 'published' ? 'bg-green-950 text-green-300' : 'bg-amber-950 text-amber-300'
            }`}>
              {trans.status}
            </span>
          </div>
          <h1 className="text-3xl font-bold text-white">{trans.headline || trans.title}</h1>
          {trans.alternative_headline && (
            <p className="text-slate-400">{trans.alternative_headline}</p>
          )}
        </header>

        {trans.summary && (
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Summary</h2>
            <p className="text-slate-200 leading-relaxed whitespace-pre-wrap">{trans.summary}</p>
          </section>
        )}

        {trans.key_takeaways && trans.key_takeaways.length > 0 && (
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Key takeaways</h2>
            <ul className="space-y-1.5">
              {trans.key_takeaways.map((kt, i) => (
                <li key={i} className="flex gap-2 text-slate-200">
                  <span className="text-red-500">•</span>
                  <span>{kt}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {trans.verdict && (
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Verdict</h2>
            <p className="text-slate-200 leading-relaxed whitespace-pre-wrap">{trans.verdict}</p>
          </section>
        )}

        {trans.red_flags && trans.red_flags.length > 0 && (
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">Red flags</h2>
            <div className="space-y-3">
              {trans.red_flags.map((rf, i) => (
                <div key={i} className="bg-red-950/30 border border-red-800/40 rounded-lg p-3">
                  <p className="font-semibold text-red-300 mb-1">{rf.title || rf.flag}</p>
                  <p className="text-sm text-slate-300">{rf.description || rf.detail}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {trans.how_it_works && (
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">How it works</h2>
            <p className="text-slate-200 leading-relaxed whitespace-pre-wrap">{trans.how_it_works}</p>
          </section>
        )}

        {trans.full_article && (
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">Full article (markdown source)</h2>
            <pre className="text-xs text-slate-300 bg-slate-900/60 border border-slate-800 rounded-lg p-4 overflow-x-auto whitespace-pre-wrap leading-relaxed">
              {trans.full_article}
            </pre>
          </section>
        )}

        {trans.faq && trans.faq.length > 0 && (
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">FAQ</h2>
            <div className="space-y-3">
              {trans.faq.map((q, i) => (
                <div key={i} className="bg-slate-900/40 border border-slate-800 rounded-lg p-3">
                  <p className="font-semibold text-slate-200 mb-1">{q.question}</p>
                  <p className="text-sm text-slate-400">{q.answer}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {trans.disclaimer && (
          <footer className="text-xs text-slate-500 border-t border-slate-800 pt-4 space-y-2">
            <p className="whitespace-pre-wrap">{trans.disclaimer}</p>
            <p className="italic">
              Translated from English by {trans.translator_name || 'Crypto Killer Editorial Team'}
              {trans.reviewed_at ? ` on ${new Date(trans.reviewed_at).toLocaleDateString(loc.bcp47)}` : ''}.
              Translation method: <code>{trans.translation_method}</code>.
            </p>
          </footer>
        )}
      </article>
    </div>
  )
}
