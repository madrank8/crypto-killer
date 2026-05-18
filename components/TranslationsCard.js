'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'

// Locale display config — must stay in sync with lib/translate.js and
// app/api/admin/reviews/[id]/translations route validation.
const LOCALES = [
  { code: 'it',    label: 'Italian',    flag: '🇮🇹' },
  { code: 'es',    label: 'Spanish',    flag: '🇪🇸' },
  { code: 'de',    label: 'German',     flag: '🇩🇪' },
  { code: 'fr',    label: 'French',     flag: '🇫🇷' },
  { code: 'pt-BR', label: 'Portuguese', flag: '🇧🇷' },
]
const LOCALE_BY_CODE = Object.fromEntries(LOCALES.map(l => [l.code, l]))

function StatusBadge({ status, isStale }) {
  if (status === 'stale' || isStale) {
    return <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-700/40">stale</span>
  }
  const styles = {
    draft:           'bg-gray-800 text-gray-300 border-gray-700',
    review_pending:  'bg-blue-950 text-blue-300 border-blue-700/40',
    published:       'bg-green-950 text-green-300 border-green-700/40',
    stale:           'bg-amber-950 text-amber-300 border-amber-700/40',
  }
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${styles[status] || styles.draft}`}>
      {status}
    </span>
  )
}

export default function TranslationsCard({ reviewId, masterSlug, masterUpdatedAt, token }) {
  const [translations, setTranslations] = useState([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(null) // locale being created
  const [actionId, setActionId] = useState(null) // 'publish-it' | 'delete-de' etc.
  const [error, setError] = useState(null)

  const fetchTranslations = useCallback(async () => {
    if (!reviewId || !token) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/reviews/${reviewId}/translations`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setTranslations(Array.isArray(data.translations) ? data.translations : [])
    } catch (e) {
      setError(e.message || 'Failed to load translations')
    } finally {
      setLoading(false)
    }
  }, [reviewId, token])

  useEffect(() => {
    fetchTranslations()
  }, [fetchTranslations])

  const handleAdd = async (locale) => {
    if (creating) return
    setCreating(locale)
    setError(null)
    try {
      const res = await fetch(`/api/admin/reviews/${reviewId}/translations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ locale }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || data.detail || `HTTP ${res.status}`)
      // Refresh list
      await fetchTranslations()
    } catch (e) {
      setError(e.message || `Failed to add ${locale} translation`)
    } finally {
      setCreating(null)
    }
  }

  const handlePublish = async (locale, unpublish = false) => {
    const actionKey = `${unpublish ? 'unpub' : 'pub'}-${locale}`
    setActionId(actionKey)
    setError(null)
    try {
      const res = await fetch(
        `/api/admin/reviews/${reviewId}/translations/${encodeURIComponent(locale)}/publish`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ unpublish }),
        }
      )
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || data.hint || `HTTP ${res.status}`)
      await fetchTranslations()
    } catch (e) {
      setError(e.message)
    } finally {
      setActionId(null)
    }
  }

  const handleDelete = async (locale) => {
    if (!confirm(`Delete the ${LOCALE_BY_CODE[locale]?.label || locale} translation? This cannot be undone.`)) return
    const actionKey = `del-${locale}`
    setActionId(actionKey)
    setError(null)
    try {
      const res = await fetch(
        `/api/admin/reviews/${reviewId}/translations/${encodeURIComponent(locale)}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        }
      )
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      await fetchTranslations()
    } catch (e) {
      setError(e.message)
    } finally {
      setActionId(null)
    }
  }

  // Helper: detect stale translations (source updated after we translated)
  const isStale = (t) => {
    if (!t.source_review_updated_at || !masterUpdatedAt) return false
    return new Date(masterUpdatedAt).getTime() > new Date(t.source_review_updated_at).getTime() + 60_000
  }

  const existingLocales = new Set(translations.map(t => t.locale))
  const remainingLocales = LOCALES.filter(l => !existingLocales.has(l.code))

  return (
    <div className="bg-dark-card border border-gray-800 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
          Translations
        </h3>
        <span className="text-[10px] text-gray-500">
          {translations.length}/{LOCALES.length}
        </span>
      </div>

      {error && (
        <div className="text-[11px] text-red-400 bg-red-950/30 border border-red-800/40 rounded p-2 whitespace-pre-wrap">
          {error}
        </div>
      )}

      {loading && translations.length === 0 ? (
        <div className="text-xs text-gray-500 italic">Loading…</div>
      ) : translations.length === 0 ? (
        <p className="text-xs text-gray-500 leading-relaxed">
          No translations yet. Generate AI-assisted translations in 5 languages — each one will land as a draft you can review before publishing.
        </p>
      ) : (
        <div className="space-y-1.5">
          {translations.map((t) => {
            const meta = LOCALE_BY_CODE[t.locale] || { flag: '🌐', label: t.locale }
            const stale = isStale(t)
            const busy = actionId?.endsWith(`-${t.locale}`)
            return (
              <div key={t.locale} className="flex items-center gap-2 text-xs">
                <span className="text-base">{meta.flag}</span>
                <Link
                  href={`/admin/review/${reviewId}/translations/${encodeURIComponent(t.locale)}`}
                  className="flex-1 text-gray-300 hover:text-white truncate"
                >
                  {meta.label}
                </Link>
                <StatusBadge status={t.status} isStale={stale} />
                {t.status === 'published' ? (
                  <button
                    onClick={() => handlePublish(t.locale, true)}
                    disabled={busy}
                    title="Unpublish"
                    className="text-gray-500 hover:text-amber-400 disabled:opacity-50 px-1"
                  >
                    ⏸
                  </button>
                ) : (
                  <button
                    onClick={() => handlePublish(t.locale, false)}
                    disabled={busy}
                    title="Publish"
                    className="text-gray-500 hover:text-green-400 disabled:opacity-50 px-1"
                  >
                    ▶
                  </button>
                )}
                <button
                  onClick={() => handleDelete(t.locale)}
                  disabled={busy}
                  title="Delete"
                  className="text-gray-600 hover:text-red-400 disabled:opacity-50 px-1"
                >
                  ✕
                </button>
              </div>
            )
          })}
        </div>
      )}

      {remainingLocales.length > 0 && (
        <div className="pt-2 border-t border-gray-800/60 space-y-1.5">
          <p className="text-[10px] text-gray-500 uppercase tracking-wider">Add translation</p>
          <div className="flex flex-wrap gap-1.5">
            {remainingLocales.map((loc) => (
              <button
                key={loc.code}
                onClick={() => handleAdd(loc.code)}
                disabled={!!creating}
                title={`AI-translate this review to ${loc.label} — takes 30-120 seconds`}
                className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium border transition ${
                  creating === loc.code
                    ? 'bg-purple-900/30 text-purple-300 border-purple-700/50'
                    : creating
                      ? 'bg-gray-900/40 text-gray-600 border-gray-800 cursor-not-allowed'
                      : 'bg-purple-600/10 text-purple-400 hover:bg-purple-600/20 border-purple-600/30'
                }`}
              >
                <span>{loc.flag}</span>
                <span>
                  {creating === loc.code ? (
                    <span className="flex items-center gap-1">
                      <span className="animate-spin">⟳</span> Translating…
                    </span>
                  ) : (
                    `+ ${loc.label}`
                  )}
                </span>
              </button>
            ))}
          </div>
          {creating && (
            <p className="text-[10px] text-gray-500 italic mt-1">
              AI translation runs in 2 passes (short fields + full article). Can take up to 2 minutes.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
