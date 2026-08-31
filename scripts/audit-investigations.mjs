#!/usr/bin/env node
/**
 * scripts/audit-investigations.mjs — Phase 1 dataset audit.
 *
 * Runs EVERY investigation in the database through the consistency validator
 * and writes a report. It is strictly read-only: no row is modified, because
 * the brief is explicit that questionable records must be reported for human
 * review rather than silently corrected. Several of the findings this produces
 * (score drift in particular) have more than one defensible resolution, and
 * choosing one automatically would be the wrong call.
 *
 *   node scripts/audit-investigations.mjs                  → markdown to stdout
 *   node scripts/audit-investigations.mjs --json           → machine-readable
 *   node scripts/audit-investigations.mjs --out report.md  → write to a file
 */

import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { validateInvestigation } = require('../lib/investigation-validator.js')
const { buildInvestigationLinks } = require('../lib/internal-links.js')

// .env.local is the repo convention for local credentials.
for (const file of ['.env.local', '.env']) {
  const p = path.join(process.cwd(), file)
  if (!fs.existsSync(p)) continue
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}

const URL_BASE = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
if (!URL_BASE || !KEY) {
  console.error('Missing SUPABASE_URL / service key in the environment or .env.local')
  process.exit(1)
}

async function rest(pathAndQuery) {
  const res = await fetch(`${URL_BASE}/rest/v1${pathAndQuery}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} on ${pathAndQuery}`)
  return res.json()
}

const SEVERITY_ORDER = { critical: 0, warning: 1 }

/** One recommended action per finding code. Kept here so the report is actionable. */
const RECOMMENDED_ACTION = {
  SCORE_DRIFT:
    'Decide which score is true, then make BOTH agree in one pass: either re-run the score sync and regenerate the article against the new number, or freeze the brand score. Never edit one copy alone.',
  SCORE_INVALID: 'Correct reviews.scam_score to a finite integer in 0-100.',
  SCORE_MISSING: 'Stamp a score during generation; the page cannot be classified without one.',
  CLASSIFICATION_ABOVE_SCORE: 'Remove the override, or lower the copy to the band the score supports.',
  DATE_CHRONOLOGY_IMPOSSIBLE: 'Fix first_seen_at / last_seen_at on the brand row — one of them is wrong.',
  PUBLISHED_AFTER_UPDATED: 'Correct published_at or updated_at; the schema dates are currently inverted.',
  METRIC_SELF_CONTRADICTION: 'Regenerate the affected fields so both places interpolate the canonical value.',
  METRIC_LITERAL_DRIFT: 'Regenerate through the writer, which emits {{stat:…}} tokens by construction. Do not hand-edit the number.',
  METRIC_HARDCODED: 'Low priority: replace the literal with a {{stat:…}} token at the next regeneration.',
  DEFINITIVE_CLAIM_UNSUPPORTED: 'Soften the wording to the classification’s register, or record the regulator warning / victim reports that would justify it.',
  CONFIRMED_EVIDENCE_SHORTFALL: 'Record a regulator warning, a second-jurisdiction enforcement action, or victim reports — or accept the one-band downgrade.',
  STRONG_CLAIM_UNSOURCED: 'Attach the source for each allegation, or remove the allegation.',
  NO_EVIDENCE_SOURCE: 'Add the sources the investigation actually used.',
  ANALYST_MISSING: 'Assign a persona id so the Person entity and byline resolve.',
  LAST_CHECKED_MISSING: 'Populate scam_brands.last_seen_at via the scraper.',
  LAST_CHECKED_STALE: 'Re-run the scraper for this brand, or mark the investigation closed.',
  FIRST_DETECTED_MISSING: 'Populate scam_brands.first_seen_at.',
  DAYS_ACTIVE_CACHE_DRIFT: 'Refresh scam_brands.lifespan_days, or drop the column — the derived value is authoritative.',
  PRIMARY_DOMAIN_MISSING: 'An analyst must confirm the platform’s own domain. Landing hostnames are cloaked landers and must not be used.',
  STATUS_MISSING: 'Set reviews.status.',
  EVIDENCE_CLASS_UNKNOWN: 'Correct the class to OBSERVED / REGULATORY / REPORTED / INFERRED.',
  REGULATORY_ITEM_NO_SOURCE: 'Attach the regulator’s URL, or reclassify the finding.',
  DUPLICATE_TEXT_BLOCK: 'Rewrite one of the duplicated passages; repeated blocks read as thin content.',
  AMBIGUOUS_PARAGRAPH_OPENER: 'Rewrite the opening clause to name its subject so the passage survives extraction.',
  OVERRIDE_REFUSED: 'Remove the override or lower its target classification.',
}

const fmtValue = (v) => {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

async function main() {
  const reviews = await rest('/reviews?select=*&order=slug.asc')
  const brands = await rest('/scam_brands?select=*&review_status=not.is.null&limit=2000')
  const brandById = new Map(brands.map((b) => [b.id, b]))

  // Landing pages for the brands we are auditing only.
  const ids = [...new Set(reviews.map((r) => r.brand_id).filter(Boolean))]
  const landingByBrand = new Map()
  for (let i = 0; i < ids.length; i += 20) {
    const chunk = ids.slice(i, i + 20)
    const rows = await rest(`/brand_landing_pages?brand_id=in.(${chunk.join(',')})&select=brand_id,live_url,live_hostname&limit=1000`)
    for (const row of rows) {
      if (!landingByBrand.has(row.brand_id)) landingByBrand.set(row.brand_id, [])
      landingByBrand.get(row.brand_id).push(row)
    }
  }

  const now = new Date()
  const results = []
  const opportunityCounts = new Map()

  for (const review of reviews) {
    let brand = review.brand_id ? brandById.get(review.brand_id) : null
    if (review.brand_id && !brand) {
      const rows = await rest(`/scam_brands?id=eq.${review.brand_id}&select=*&limit=1`)
      brand = rows[0] || null
    }
    const landingPages = landingByBrand.get(review.brand_id) || []
    let r
    try {
      r = validateInvestigation({ review, brand, landingPages, now })
    } catch (err) {
      results.push({ slug: review.slug, status: review.status, error: err.message, findings: [], canPublish: false })
      continue
    }
    for (const o of buildInvestigationLinks(r.investigation).opportunities) {
      opportunityCounts.set(o.family, (opportunityCounts.get(o.family) || 0) + 1)
    }
    results.push({
      slug: review.slug,
      status: review.status,
      score: r.investigation.threat_score,
      liveScore: r.investigation.live_brand_score,
      classification: r.investigation.threat_classification,
      canPublish: r.canPublish,
      findings: r.findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]),
    })
  }

  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify({ generated_at: now.toISOString(), results }, null, 2))
    return
  }

  const md = renderMarkdown(results, opportunityCounts, now)
  const outIdx = process.argv.indexOf('--out')
  if (outIdx > -1 && process.argv[outIdx + 1]) {
    fs.writeFileSync(process.argv[outIdx + 1], md)
    console.error(`Wrote ${process.argv[outIdx + 1]}`)
  } else {
    process.stdout.write(md)
  }
}

function renderMarkdown(results, opportunityCounts, now) {
  const total = results.length
  const blocked = results.filter((r) => !r.canPublish)
  const counts = new Map()
  for (const r of results) {
    for (const f of r.findings) {
      const k = `${f.severity}:${f.code}`
      counts.set(k, (counts.get(k) || 0) + 1)
    }
  }
  const lines = []
  lines.push('# Investigation dataset audit — Phase 1')
  lines.push('')
  lines.push(`Generated ${now.toISOString()} against ${total} investigation${total === 1 ? '' : 's'}.`)
  lines.push('')
  lines.push('**Read-only.** No row was modified. Every entry below needs a human decision, and the')
  lines.push('recommended action is a suggestion, not something the tooling applied.')
  lines.push('')
  lines.push(`- Investigations that would FAIL the publish gate today: **${blocked.length} / ${total}**`)
  lines.push(`- Investigations with zero findings: **${results.filter((r) => r.findings.length === 0).length}**`)
  lines.push('')
  lines.push('## Findings by code')
  lines.push('')
  lines.push('| Severity | Code | Count |')
  lines.push('|---|---|---:|')
  for (const [k, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    const [sev, code] = k.split(':')
    lines.push(`| ${sev} | \`${code}\` | ${n} |`)
  }
  lines.push('')
  if (opportunityCounts.size) {
    lines.push('## Internal-link opportunities (page types that do not exist yet)')
    lines.push('')
    lines.push('No links were created for these. Recorded here as Phase 2 scope.')
    lines.push('')
    lines.push('| Wanted page type | Links it would carry |')
    lines.push('|---|---:|')
    for (const [family, n] of [...opportunityCounts.entries()].sort((a, b) => b[1] - a[1])) {
      lines.push(`| \`${family}\` | ${n} |`)
    }
    lines.push('')
  }
  lines.push('## Per-investigation detail')
  lines.push('')
  for (const r of results) {
    if (r.findings.length === 0 && !r.error) continue
    lines.push(`### \`/review/${r.slug}\``)
    lines.push('')
    lines.push(
      `Status: ${r.status} · score ${r.score ?? '—'}/100 (live brand ${r.liveScore ?? '—'}) · ` +
        `${r.classification || '—'} · publishable today: **${r.canPublish ? 'yes' : 'NO'}**`,
    )
    lines.push('')
    if (r.error) {
      lines.push(`> Validator error: ${r.error}`)
      lines.push('')
      continue
    }
    lines.push('| Severity | Issue | Field | Current value(s) | Recommended action |')
    lines.push('|---|---|---|---|---|')
    for (const f of r.findings) {
      const current = fmtValue(f.current).replace(/\|/g, '\\|').slice(0, 160)
      const msg = f.message.replace(/\|/g, '\\|').replace(/\n/g, ' ')
      const action = (RECOMMENDED_ACTION[f.code] || 'Manual review required.').replace(/\|/g, '\\|')
      lines.push(`| ${f.severity} | \`${f.code}\` — ${msg} | \`${f.field}\` | ${current || '—'} | ${action} |`)
    }
    lines.push('')
  }
  return lines.join('\n')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
