import { EVIDENCE_CLASSES, classifyEvidence } from '@/lib/evidence-labels'

/**
 * components/investigation/EvidenceLabel.js — the four evidence classes,
 * rendered. Phase 1, 2026-08-31.
 *
 * The visual weight is deliberately ordered: OBSERVED and REGULATORY read as
 * assertions, REPORTED and INFERRED read as qualified. A reader skimming the
 * page should be able to tell which is which without reading the legend, and
 * an answer engine gets the class as literal text inside the block rather than
 * as a colour it cannot see.
 *
 * Server component — no state, no client bundle.
 */

const TONE = {
  observed: {
    chip: 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30',
    rail: 'border-emerald-500/40',
  },
  regulatory: {
    chip: 'bg-sky-500/15 text-sky-300 ring-1 ring-sky-500/30',
    rail: 'border-sky-500/40',
  },
  reported: {
    chip: 'bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30',
    rail: 'border-amber-500/40',
  },
  inferred: {
    chip: 'bg-slate-500/15 text-slate-300 ring-1 ring-slate-500/30',
    rail: 'border-slate-600/50',
  },
}

export function EvidenceChip({ evidenceClass, title }) {
  const cls = classifyEvidence(evidenceClass)
  const tone = TONE[cls.tone] || TONE.inferred
  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 text-[11px] font-bold tracking-widest uppercase ${tone.chip}`}
      title={title || cls.definition}
    >
      {cls.label}
    </span>
  )
}

/**
 * One labelled finding.
 *
 * @param {object} item normalized by lib/evidence-labels.js
 */
export default function EvidenceLabel({ item }) {
  if (!item || !item.claim) return null
  const cls = classifyEvidence(item.evidence_class)
  const tone = TONE[cls.tone] || TONE.inferred
  const window =
    item.observed_from && item.observed_to && item.observed_from !== item.observed_to
      ? `${item.observed_from} → ${item.observed_to}`
      : item.observed_from || null

  return (
    <li
      className={`border-l-2 ${tone.rail} pl-4 py-2`}
      data-evidence-class={cls.key}
      data-metric={item.metric_key || undefined}
    >
      <div className="flex flex-wrap items-center gap-2 mb-1">
        <EvidenceChip evidenceClass={cls.key} />
        {window ? <span className="text-xs text-slate-500 font-mono">{window}</span> : null}
      </div>
      <p className="text-slate-200 leading-relaxed">{item.claim}</p>
      {item.source_url ? (
        <a
          href={item.source_url}
          rel="nofollow noopener"
          target="_blank"
          className="text-xs text-sky-400 hover:text-sky-300 break-all"
        >
          {item.source_url}
        </a>
      ) : null}
    </li>
  )
}

/** The legend. Rendered once per page, near the first labelled block. */
export function EvidenceLegend({ classes = null }) {
  const keys = classes && classes.length ? classes : Object.keys(EVIDENCE_CLASSES)
  return (
    <dl className="grid gap-2 sm:grid-cols-2 text-sm border border-slate-800 rounded-lg p-4 bg-slate-900/40">
      {keys.map((k) => {
        const c = EVIDENCE_CLASSES[k]
        if (!c) return null
        return (
          <div key={k} className="flex gap-2 items-start">
            <dt className="shrink-0 pt-0.5">
              <EvidenceChip evidenceClass={k} />
            </dt>
            <dd className="text-slate-400 leading-snug">{c.definition}</dd>
          </div>
        )
      })}
    </dl>
  )
}

/** A list of findings, in evidence-strength order. */
export function EvidenceList({ items = [] }) {
  const rows = items.filter((i) => i && i.claim)
  if (rows.length === 0) return null
  return <ul className="space-y-1">{rows.map((it) => <EvidenceLabel key={it.id} item={it} />)}</ul>
}
