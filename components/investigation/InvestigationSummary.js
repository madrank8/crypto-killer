import Link from 'next/link'
import { investigationSummary } from '@/lib/investigation-model'

/**
 * components/investigation/InvestigationSummary.js — Phase 1, 2026-08-31.
 *
 * ONE card shape, used by the investigation page, the archive, the
 * related-investigation module and any future database page. Everything it
 * renders comes from `investigationSummary()`, so a card can never state a
 * score or a date the canonical record does not hold.
 *
 * Exposes exactly the fields the brief specifies: brand, score, classification,
 * last checked, primary scam type, key observed metric, investigation URL.
 */

const TONE = {
  CONFIRMED: 'bg-red-500/15 text-red-300 ring-red-500/40',
  HIGH_RISK: 'bg-orange-500/15 text-orange-300 ring-orange-500/40',
  ELEVATED_RISK: 'bg-amber-500/15 text-amber-300 ring-amber-500/40',
  UNDER_INVESTIGATION: 'bg-sky-500/15 text-sky-300 ring-sky-500/40',
  LIMITED_EVIDENCE: 'bg-slate-500/15 text-slate-300 ring-slate-500/40',
}

export function ClassificationBadge({ classification, label, score }) {
  const tone = TONE[classification] || TONE.LIMITED_EVIDENCE
  return (
    <span className={`inline-flex items-center gap-2 rounded px-2.5 py-1 text-xs font-bold uppercase tracking-wider ring-1 ${tone}`}>
      {label}
      {Number.isFinite(score) ? <span className="font-mono opacity-80">{score}/100</span> : null}
    </span>
  )
}

/**
 * @param {object} props.investigation canonical record (lib/investigation-model)
 * @param {'card'|'row'} props.variant
 */
export default function InvestigationSummary({ investigation, variant = 'card' }) {
  if (!investigation) return null
  const s = investigationSummary(investigation)
  if (!s.brand) return null

  const metric = s.key_observed_metric
    ? `${s.key_observed_metric.value.toLocaleString('en-US')} ${s.key_observed_metric.label}`
    : null

  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-bold text-white leading-tight">{s.brand}</h3>
        <ClassificationBadge classification={s.classification} label={s.classification_label} score={s.score} />
      </div>
      {/* Self-contained sentence: names its subject, so it survives extraction. */}
      <p className="text-sm text-slate-400 mt-2">
        {`Crypto Killer classifies ${s.brand} as ${s.classification_label}`}
        {Number.isFinite(s.score) ? ` at ${s.score}/100` : ''}
        {s.primary_scam_type ? `, primarily ${s.primary_scam_type.replace(/_/g, ' ')}` : ''}
        {'.'}
      </p>
      <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500">
        {metric ? (
          <div className="flex gap-1.5">
            <dt className="sr-only">Key observed metric</dt>
            <dd className="font-mono text-slate-300">{metric}</dd>
          </div>
        ) : null}
        {s.last_checked ? (
          <div className="flex gap-1.5">
            <dt>Last checked</dt>
            <dd className="font-mono text-slate-300">
              <time dateTime={s.last_checked}>{s.last_checked}</time>
            </dd>
          </div>
        ) : null}
      </dl>
    </>
  )

  const className =
    variant === 'row'
      ? 'block border-b border-slate-800 py-4 hover:bg-slate-900/40 transition-colors'
      : 'block border border-slate-800 rounded-lg p-4 bg-slate-900/40 hover:border-slate-700 transition-colors'

  return s.url ? (
    <Link href={new URL(s.url).pathname} className={className} data-investigation-slug={investigation.slug}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  )
}
