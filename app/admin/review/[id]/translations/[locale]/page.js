'use client'

import { useState, useEffect, useCallback, use } from 'react'
import { useAdmin } from '@/lib/admin-context'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

const LOCALE_META = {
  'it':    { label: 'Italian',    flag: '🇮🇹', bcp47: 'it-IT' },
  'es':    { label: 'Spanish',    flag: '🇪🇸', bcp47: 'es-ES' },
  'de':    { label: 'German',     flag: '🇩🇪', bcp47: 'de-DE' },
  'fr':    { label: 'French',     flag: '🇫🇷', bcp47: 'fr-FR' },
  'pt-BR': { label: 'Portuguese', flag: '🇧🇷', bcp47: 'pt-BR' },
}

const EDITABLE_TEXT_FIELDS = [
  { key: 'title',                label: 'Title',                rows: 2 },
  { key: 'meta_description',     label: 'Meta description',     rows: 3 },
  { key: 'headline',             label: 'Headline',             rows: 2 },
  { key: 'alternative_headline', label: 'Alternative headline', rows: 2 },
  { key: 'summary',              label: 'Summary',              rows: 4 },
  { key: 'verdict',              label: 'Verdict',              rows: 3 },
  { key: 'how_it_works',         label: 'How it works',         rows: 6 },
  { key: 'not_for_you',          label: 'Not for you',          rows: 3 },
  { key: 'protection_steps',     label: 'Protection steps',     rows: 4 },
  { key: 'methodology',          label: 'Methodology',          rows: 4 },
  { key: 'expertise_depth',      label: 'Expertise depth',      rows: 3 },
  { key: 'disclaimer',           label: 'Disclaimer',           rows: 2 },
]

function StatusBadge({ status }) {
  const styles = {
    draft:          'bg-gray-800 text-gray-300 border-gray-700',
    review_pending: 'bg-blue-950 text-blue-300 border-blue-700/40',
    published:      'bg-green-950 text-green-300 border-green-700/40',
    stale:          'bg-amber-950 text-amber-300 border-amber-700/40',
  }
  return (
    <span className={`text-xs px-2 py-0.5 rounded border ${styles[status] || styles.draft}`}>
      {status}
    </span>
  )
}

export default function TranslationEditor({ params }) {
  const resolvedParams = typeof params?.then === 'function' ? use(params) : params
  const reviewId = resolvedParams?.id
  const locale = resolvedParams?.locale
  const meta = LOCALE_META[locale]

  const { token } = useAdmin()
  const router = useRouter()

  const [translation, setTranslation] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [dirty, setDirty] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)

  // Local string state for the JSON-textarea fields. Without this, every
  // keystroke re-renders with JSON.stringify(state) as the value prop, which
  // overwrites the user's mid-typing input the moment it's not valid JSON
  // (e.g. they delete a comma and the parse fails — value snaps back). We
  // keep the raw textarea string here and only sync to `translation` state
  // when it parses to a valid array.
  const [redFlagsRaw, setRedFlagsRaw] = useState('')
  const [faqRaw, setFaqRaw] = useState('')
  const [redFlagsValid, setRedFlagsValid] = useState(true)
  const [faqValid, setFaqValid] = useState(true)

  const load = useCallback(async () => {
    if (!reviewId || !locale || !token) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/reviews/${reviewId}/translations/${encodeURIComponent(locale)}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setTranslation(data.translation)
      // Seed the raw-JSON textarea state from the fetched translation
      setRedFlagsRaw(JSON.stringify(data.translation?.red_flags ?? [], null, 2))
      setFaqRaw(JSON.stringify(data.translation?.faq ?? [], null, 2))
      setRedFlagsValid(true)
      setFaqValid(true)
      setDirty(false)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [reviewId, locale, token])

  useEffect(() => { load() }, [load])

  const setField = (key, value) => {
    setTranslation((t) => ({ ...t, [key]: value }))
    setDirty(true)
  }

  const setJsonField = (key, value) => {
    setTranslation((t) => ({ ...t, [key]: value }))
    setDirty(true)
  }

  const handleSave = async () => {
    if (!translation) return
    if (!redFlagsValid || !faqValid) {
      setError('Fix the invalid JSON in Red Flags / FAQ before saving.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const editableKeys = [
        'slug',
        'title','meta_description','headline','alternative_headline','summary',
        'how_it_works','verdict','full_article','not_for_you','protection_steps',
        'methodology','disclaimer','expertise_depth',
        'red_flags','faq','key_takeaways',
        'translator_name','translator_credentials',
      ]
      const body = {}
      for (const k of editableKeys) {
        if (translation[k] !== undefined) body[k] = translation[k]
      }
      const res = await fetch(
        `/api/admin/reviews/${reviewId}/translations/${encodeURIComponent(locale)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
        }
      )
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setTranslation(data.translation)
      setDirty(false)
      setSavedFlash(true)
      setTimeout(() => setSavedFlash(false), 1800)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const handlePublishToggle = async () => {
    if (!translation) return
    const unpublish = translation.status === 'published'
    setSaving(true)
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
      setTranslation((t) => ({ ...t, ...data.translation }))
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  // ─── Render guards ──
  if (!meta) {
    return (
      <div className="text-red-400 p-6">
        Unsupported locale: <code>{locale}</code>
      </div>
    )
  }

  if (loading) {
    return <div className="text-gray-500 p-6">Loading {meta.label} translation…</div>
  }

  if (!translation) {
    return (
      <div className="p-6 space-y-3">
        <div className="text-red-400">{error || 'Translation not found'}</div>
        <Link href={`/admin/review/${reviewId}`} className="text-sm text-gray-400 hover:text-white">
          ← Back to review
        </Link>
      </div>
    )
  }

  const published = translation.status === 'published'

  return (
    <div className="space-y-4 max-w-4xl">
      {/* Top bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <Link href={`/admin/review/${reviewId}`} className="text-gray-500 hover:text-gray-300 transition">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <h1 className="text-lg font-bold text-white truncate flex items-center gap-2">
            <span>{meta.flag}</span> {meta.label} translation
          </h1>
          <StatusBadge status={translation.status} />
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {dirty && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-amber-950/60 text-amber-300 border border-amber-700/40">
              Unsaved changes
            </span>
          )}
          {savedFlash && (
            <span className="text-xs text-green-400">✓ Saved</span>
          )}
          <button
            onClick={handleSave}
            disabled={saving || !dirty || !redFlagsValid || !faqValid}
            className="text-sm font-medium px-4 py-2 rounded-lg bg-dark-card text-gray-300 hover:text-white border border-gray-800 hover:border-gray-700 transition disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          {published && translation.slug && (
            <a
              href={`https://cryptokiller.org/${locale.toLowerCase()}/review/${translation.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium px-4 py-2 rounded-lg bg-green-600/10 text-green-400 hover:bg-green-600/20 border border-green-600/20 transition"
            >
              View Live
            </a>
          )}
          <button
            onClick={handlePublishToggle}
            disabled={saving || dirty}
            title={dirty ? 'Save changes before publishing' : undefined}
            className={`text-sm font-semibold px-4 py-2 rounded-lg transition ${
              published
                ? 'text-gray-400 hover:text-white border border-gray-800 hover:border-gray-700'
                : 'bg-red-600 hover:bg-red-700 text-white'
            } disabled:opacity-50`}
          >
            {published ? 'Unpublish' : 'Publish'}
          </button>
        </div>
      </div>

      {error && (
        <div className="py-2 px-3 bg-red-900/20 border border-red-600/30 rounded-lg text-red-400 text-sm whitespace-pre-wrap">
          {error}
        </div>
      )}

      {/* Provenance line */}
      <div className="text-[11px] text-gray-500 flex items-center gap-3 flex-wrap">
        <span>Method: <code className="text-gray-400">{translation.translation_method}</code></span>
        <span>Model: <code className="text-gray-400">{translation.ai_model || '—'}</code></span>
        <span>Translator: <code className="text-gray-400">{translation.translator_name || '—'}</code></span>
        {translation.reviewed_at && <span>Reviewed: {new Date(translation.reviewed_at).toLocaleString()}</span>}
        <span>Words: {translation.word_count}</span>
      </div>

      {/* Slug */}
      <div>
        <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1">
          Per-locale slug · /{locale.toLowerCase()}/review/<code>{translation.slug || '…'}</code>
        </label>
        <input
          type="text"
          value={translation.slug || ''}
          onChange={(e) => setField('slug', e.target.value)}
          placeholder="recensione-polso-crescianza"
          className="w-full bg-dark-bg border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 font-mono focus:outline-none focus:border-gray-500"
        />
        <p className="text-[11px] text-gray-500 mt-1">
          Override with a native-language slug for better CTR. Defaults to the master EN slug.
        </p>
      </div>

      {/* Text fields */}
      {EDITABLE_TEXT_FIELDS.map((f) => (
        <div key={f.key}>
          <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1">
            {f.label}
          </label>
          <textarea
            rows={f.rows}
            value={translation[f.key] || ''}
            onChange={(e) => setField(f.key, e.target.value)}
            className="w-full bg-dark-bg border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-gray-500 resize-y"
          />
        </div>
      ))}

      {/* Key takeaways (array of strings) */}
      <div>
        <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1">
          Key takeaways (one per line)
        </label>
        <textarea
          rows={6}
          value={(translation.key_takeaways || []).join('\n')}
          onChange={(e) => setJsonField('key_takeaways', e.target.value.split('\n').filter(s => s.trim()))}
          className="w-full bg-dark-bg border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-gray-500 resize-y"
        />
      </div>

      {/* Red flags (array of objects — JSON edit; preserves source key shape) */}
      <div>
        <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1">
          Red flags (JSON array)
          {!redFlagsValid && (
            <span className="ml-2 text-amber-400 normal-case">⚠ invalid JSON — fix to save</span>
          )}
        </label>
        <textarea
          rows={8}
          value={redFlagsRaw}
          onChange={(e) => {
            const next = e.target.value
            setRedFlagsRaw(next)
            try {
              const parsed = JSON.parse(next)
              if (Array.isArray(parsed)) {
                setJsonField('red_flags', parsed)
                setRedFlagsValid(true)
              } else {
                setRedFlagsValid(false)
              }
            } catch {
              setRedFlagsValid(false)
              setDirty(true) // user is editing, even if not yet valid
            }
          }}
          className={`w-full bg-dark-bg border rounded-lg px-3 py-2 text-xs text-gray-300 font-mono focus:outline-none resize-y ${
            redFlagsValid ? 'border-gray-700 focus:border-gray-500' : 'border-amber-700/60 focus:border-amber-600'
          }`}
        />
      </div>

      {/* FAQ (array of {question, answer} — JSON edit; preserves source key shape) */}
      <div>
        <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1">
          FAQ (JSON array)
          {!faqValid && (
            <span className="ml-2 text-amber-400 normal-case">⚠ invalid JSON — fix to save</span>
          )}
        </label>
        <textarea
          rows={10}
          value={faqRaw}
          onChange={(e) => {
            const next = e.target.value
            setFaqRaw(next)
            try {
              const parsed = JSON.parse(next)
              if (Array.isArray(parsed)) {
                setJsonField('faq', parsed)
                setFaqValid(true)
              } else {
                setFaqValid(false)
              }
            } catch {
              setFaqValid(false)
              setDirty(true)
            }
          }}
          className={`w-full bg-dark-bg border rounded-lg px-3 py-2 text-xs text-gray-300 font-mono focus:outline-none resize-y ${
            faqValid ? 'border-gray-700 focus:border-gray-500' : 'border-amber-700/60 focus:border-amber-600'
          }`}
        />
      </div>

      {/* Full article (markdown) */}
      <div>
        <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1">
          Full article (markdown)
        </label>
        <textarea
          rows={30}
          value={translation.full_article || ''}
          onChange={(e) => setField('full_article', e.target.value)}
          className="w-full bg-dark-bg border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 font-mono focus:outline-none focus:border-gray-500 resize-y leading-relaxed"
        />
      </div>

      {/* Bottom action bar */}
      <div className="flex items-center justify-between pt-4 border-t border-gray-800">
        <Link href={`/admin/review/${reviewId}`} className="text-sm text-gray-500 hover:text-white">
          ← Back to master review
        </Link>
        <button
          onClick={handleSave}
          disabled={saving || !dirty || !redFlagsValid || !faqValid}
          className="text-sm font-medium px-4 py-2 rounded-lg bg-dark-card text-gray-300 hover:text-white border border-gray-800 hover:border-gray-700 transition disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}
