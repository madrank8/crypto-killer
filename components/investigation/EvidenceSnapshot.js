import { evidenceSnapshotRows } from '@/lib/investigation-model'

/**
 * components/investigation/EvidenceSnapshot.js — Phase 1, 2026-08-31.
 *
 * A semantic <table> of the investigation's canonical metrics. Every row comes
 * from `evidenceSnapshotRows()`, which omits any field with no meaningful data
 * — a blank or "0" row is a factual claim we have not made, and on a YMYL page
 * an unmade claim must be absent, not empty.
 *
 * `data-canonical-field` on each row is what makes the table auditable: a
 * crawler, a test or a human can point at a number and get the column it came
 * from.
 */
export default function EvidenceSnapshot({ investigation, caption }) {
  const rows = evidenceSnapshotRows(investigation)
  if (rows.length === 0) return null

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse">
        <caption className="text-left text-sm text-slate-500 mb-3">
          {caption ||
            `Canonical surveillance record for ${investigation.brand_name}${
              investigation.last_checked_date ? `, last checked ${investigation.last_checked_date}` : ''
            }.`}
        </caption>
        <thead>
          <tr className="border-b border-slate-700">
            <th scope="col" className="py-2 pr-4 text-xs font-semibold uppercase tracking-wider text-slate-400">
              Field
            </th>
            <th scope="col" className="py-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
              Value
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-b border-slate-800/70" data-canonical-field={r.key} data-source={r.source}>
              <th scope="row" className="py-2.5 pr-4 font-normal text-slate-400 align-top">
                {r.label}
              </th>
              <td className="py-2.5 text-white font-medium tabular-nums">{r.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
