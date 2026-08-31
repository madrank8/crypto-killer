import { ClassificationBadge } from './InvestigationSummary'

/**
 * components/investigation/CurrentAssessment.js — Phase 1, 2026-08-31.
 *
 * The block directly under the H1. It is the single passage most likely to be
 * lifted whole by an answer engine, so it is written to survive extraction:
 * the brand is named in the first clause, the classification and score are in
 * the same sentence, the evidence summary is generated from canonical metrics,
 * and the last-checked date is stated rather than implied.
 *
 * No sentence here is authored by a model. Every number is interpolated from
 * the canonical record, so this block cannot drift from the Evidence Snapshot
 * table underneath it.
 */

function evidenceClause(i) {
  const parts = []
  if (i.creatives_observed > 0) {
    parts.push(`${i.creatives_observed.toLocaleString('en-US')} advertising creative${i.creatives_observed === 1 ? '' : 's'}`)
  }
  if (i.public_figures_impersonated > 0) {
    parts.push(`${i.public_figures_impersonated.toLocaleString('en-US')} impersonated public figure${i.public_figures_impersonated === 1 ? '' : 's'}`)
  }
  if (i.countries_targeted > 0) {
    parts.push(`${i.countries_targeted.toLocaleString('en-US')} targeted countr${i.countries_targeted === 1 ? 'y' : 'ies'}`)
  }
  if (parts.length === 0) return null
  if (parts.length === 1) return parts[0]
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

export default function CurrentAssessment({ investigation }) {
  const i = investigation
  if (!i) return null
  const evidence = evidenceClause(i)
  const window =
    i.first_detected_date && i.last_checked_date
      ? ` between ${i.first_detected_date} and ${i.last_checked_date}`
      : ''

  return (
    <section
      aria-labelledby="current-assessment-heading"
      className="border border-slate-700 rounded-lg bg-slate-900/60 p-5 my-6"
      data-block="current-assessment"
    >
      <h2 id="current-assessment-heading" className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400 mb-3">
        Current assessment
      </h2>

      <div className="mb-3">
        <ClassificationBadge
          classification={i.threat_classification}
          label={i.threat_classification_label}
          score={i.threat_score}
        />
      </div>

      <p className="text-lg text-slate-100 leading-relaxed">
        {`Crypto Killer classifies ${i.brand_name} as ${i.threat_classification_label} at ${i.threat_score}/100 on its threat index.`}
        {evidence
          ? ` Crypto Killer surveillance recorded ${evidence} for ${i.brand_name}${window}.`
          : ` Crypto Killer has not yet recorded surveillance evidence for ${i.brand_name}.`}
      </p>

      {/* The shortfall is stated, not hidden: an 80+ score that has not met the
          methodology's evidentiary test is a materially different claim from a
          confirmed one, and the reader is entitled to the difference. */}
      {i.classification_downgraded && Array.isArray(i.evidence_shortfall) ? (
        <p className="mt-3 text-sm text-amber-300/90 leading-relaxed">
          {`${i.brand_name} scores in Crypto Killer's confirmed band, but the published methodology also requires ${i.evidence_shortfall.join(', or ')}. None is on file, so ${i.brand_name} is presented as ${i.threat_classification_label} rather than a confirmed scam.`}
        </p>
      ) : null}

      {i.last_checked_date ? (
        <p className="mt-3 text-sm text-slate-400">
          Last checked:{' '}
          <time dateTime={i.last_checked_date} className="font-mono text-slate-300">
            {i.last_checked_date}
          </time>
          {Number.isFinite(i.days_active) && i.days_active > 0
            ? ` · ${i.days_active.toLocaleString('en-US')} days between first detection and most recent check.`
            : '.'}
        </p>
      ) : null}
    </section>
  )
}
