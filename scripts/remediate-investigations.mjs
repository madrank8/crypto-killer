#!/usr/bin/env node
/**
 * scripts/remediate-investigations.mjs — Phase 1 remediation engine.
 * 2026-08-31.
 *
 * Executes the three DETERMINISTIC fix classes the audit prescribed, per the
 * approved policy (adopt the live brand score; dry-run before apply):
 *
 *   WAVE A  Score alignment. reviews.scam_score := scam_brands.scam_score,
 *           plus every threat-score literal in prose and schema_json:
 *             A1  "<oldColumnScore>/100" → new score (unambiguous — the July
 *                 backfill precedent, lib/review-stat-tokenizer.js)
 *             A2  any OTHER "N/100" whose surrounding text is clearly about
 *                 THE BRAND'S threat score (context window mentions threat
 *                 score/index/scoring) and is not a category sub-score or
 *                 audit score. Every A2 hit is itemised for human eyes —
 *                 this class only runs because the corpus provably contains
 *                 third values (crest says 13/100; column 15; brand 5).
 *
 *   WAVE B  Metric literal correction. A number in prose that contradicts the
 *           canonical record (creatives / countries / figures / days active)
 *           becomes the canonical value. Inline-tag tolerant, platform-context
 *           aware — same guards as the validator. This intentionally leaves a
 *           METRIC_HARDCODED *warning* behind: literals become tokens only via
 *           writer regeneration (see review-stat-tokenizer.js for why).
 *
 *   WAVE C  Register alignment. On pages whose (new) classification does not
 *           license them:
 *             C1  unhedged fraud assertions → hedged equivalents
 *                 ("is a confirmed X scam"→"is a suspected X scam";
 *                  "is a fraudulent <thing>"→"displays the hallmarks of a
 *                  fraudulent <thing>"; bare "is a scam"→"is a suspected scam")
 *             C2  sub-ELEVATED "Do not deposit any money." →
 *                 "Verify the platform's regulatory status independently
 *                  before depositing any money."
 *
 * Every change appends a visible update_history entry (type 'edited') and
 * bumps updated_at — dateModified only moves with visible provenance, per the
 * freshness-engine rules.
 *
 * NEVER touched here: sources, evidence, red-flag substance, structure. The
 * LLM-shaped work (tokens by construction, band-crossing prose registers) is
 * Wave 2 regeneration, not this script.
 *
 *   node scripts/remediate-investigations.mjs                → DRY RUN (default)
 *   node scripts/remediate-investigations.mjs --out plan.md  → dry-run report to file
 *   node scripts/remediate-investigations.mjs --apply        → write to Supabase
 */

import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { classifyThreat, brandEvidence } = require('../lib/threat-classification.js')
const { buildInvestigation } = require('../lib/investigation-model.js')
const { fixScoreLiterals, fixMetricLiterals, fixRegister } = require('../lib/remediation.js')

for (const file of ['.env.local', '.env']) {
  const p = path.join(process.cwd(), file)
  if (!fs.existsSync(p)) continue
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}
const URL_BASE = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
if (!URL_BASE || !KEY) {
  console.error('Missing SUPABASE_URL / service-role key')
  process.exit(1)
}
const APPLY = process.argv.includes('--apply')

async function rest(pathAndQuery, init = {}) {
  const res = await fetch(`${URL_BASE}/rest/v1${pathAndQuery}`, {
    ...init,
    headers: {
      apikey: KEY, Authorization: `Bearer ${KEY}`, Accept: 'application/json',
      'Content-Type': 'application/json', ...(init.headers || {}),
    },
  })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} on ${pathAndQuery}: ${await res.text()}`)
  return res.status === 204 ? null : res.json()
}

// ─── field inventory ──────────────────────────────────────────────────────

/** Scalar prose columns remediated in place. */
const SCALAR_FIELDS = [
  'title', 'headline', 'alternative_headline', 'meta_description', 'summary',
  'verdict', 'how_it_works', 'full_article', 'not_for_you', 'protection_steps',
  'expertise_depth', 'information_gain_summary',
]
// methodology/disclaimer/ai_disclosure are PLATFORM boilerplate — untouched,
// same exclusion as the validator.

// Transforms live in lib/remediation.js (unit-tested there).

// ─── WAVE D: evidence recording ──────────────────────────────────────────
//
// Recording external corroboration is allowed ONLY when the value traces to
// the canonical store and has been re-verified live. One entry qualifies:
//
//   quantum-ai — the review's own `sources`/`citations` carry
//   https://www.fca.org.uk/news/warnings/quantum-ai ("FCA Warning: Quantum
//   AI", Financial Conduct Authority). Fetched and confirmed live on
//   2026-08-31: a genuine FCA warning naming Quantum AI, first published
//   2025-05-14, updated 2026-03-03, listing the firm's own domains
//   quantumai.co and quantumai.co.com. Recording it satisfies the published
//   methodology's CONFIRMED evidentiary test, so quantum-ai's existing
//   confirmed-scam language becomes LICENSED and is deliberately NOT softened.
//   The FCA page also answers primary_domain with a regulatory source — far
//   stronger than any cloaked-lander candidate.
//
// kaspi-ai's claimed "Kazakhstan police cybercrime warnings" do NOT qualify:
// its sources list only portal homepages (gov.kz), not a warning page naming
// the entity. Its language is softened and the analyst flag stands.
const EVIDENCE_PATCHES = {
  'quantum-ai': {
    provenance: 'reviews.sources[2] + reviews.citations[0]; re-verified live 2026-08-31',
    patch: {
      regulator_warnings: [{
        regulator: 'FCA', jurisdiction: 'GB',
        url: 'https://www.fca.org.uk/news/warnings/quantum-ai',
        published_at: '2025-05-14', title: 'FCA Warning: Quantum AI',
      }],
      regulators_checked: [
        { regulator: 'FCA', jurisdiction: 'GB', register_url: 'https://register.fca.org.uk/', checked_at: '2026-07-22', result: 'warned' },
        { regulator: 'SEC', jurisdiction: 'US', register_url: 'https://www.sec.gov/edgar/search/#/q=%22Quantum%20AI%22', checked_at: '2026-07-22', result: 'not_listed' },
      ],
      primary_domain: 'quantumai.co',
      alternate_domains: ['quantumai.co.com'],
    },
  },
}

function normName(n) {
  return String(n || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
}
function slugifyName(n) {
  return String(n || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

// ─── per-review plan ──────────────────────────────────────────────────────

function planReview(review, brand) {
  const log = []
  const patch = {}

  const oldScore = Number.isFinite(review.scam_score) ? review.scam_score : null
  const liveScore = Number.isFinite(brand?.scam_score) ? brand.scam_score : null
  const newScore = liveScore ?? oldScore
  if (newScore === null) return { log, patch, skipped: 'no score on either row' }

  if (oldScore !== newScore) {
    patch.scam_score = newScore
    log.push({ wave: 'A0', field: 'scam_score', from: String(oldScore), to: String(newScore) })
  }

  const threat = classifyThreat(newScore, brandEvidence(brand), {
    override: review.classification_override || brand?.classification_override || null,
  })
  const inv = buildInvestigation({ review: { ...review, scam_score: newScore }, brand })
  const canon = {
    countries_targeted: inv.countries_targeted,
    public_figures_impersonated: inv.public_figures_impersonated,
    creatives_observed: inv.creatives_observed,
    days_active: inv.days_active,
  }

  const fix = (text, field) => {
    let out = fixScoreLiterals(text, oldScore, newScore, log, field)
    out = fixMetricLiterals(out, canon, log, field, { first_detected_date: inv.first_detected_date, last_checked_date: inv.last_checked_date })
    out = fixRegister(out, threat, log, field)
    return out
  }

  for (const f of SCALAR_FIELDS) {
    if (typeof review[f] !== 'string' || !review[f]) continue
    const out = fix(review[f], f)
    if (out !== review[f]) patch[f] = out
  }
  // experience_signals carry per-brand claims ("monitored X for N days") and
  // were invisible to the first remediation pass — the deployed auditor
  // caught a frozen "26 days" here on affitto (2026-08-31).
  if (Array.isArray(review.experience_signals)) {
    const out = review.experience_signals.map((k, i) => (typeof k === 'string' ? fix(k, `experience_signals[${i}]`) : k))
    if (JSON.stringify(out) !== JSON.stringify(review.experience_signals)) patch.experience_signals = out
  }
  // methodology/disclaimer are platform boilerplate for METRIC purposes, but
  // they embed the brand's own score ("scores 3/100") — score literals only.
  for (const f of ['methodology', 'disclaimer']) {
    if (typeof review[f] !== 'string' || !review[f]) continue
    const out = fixScoreLiterals(review[f], oldScore, newScore, log, f)
    if (out !== review[f]) patch[f] = out
  }
  if (Array.isArray(review.key_takeaways)) {
    const out = review.key_takeaways.map((k, i) => (typeof k === 'string' ? fix(k, `key_takeaways[${i}]`) : k))
    if (JSON.stringify(out) !== JSON.stringify(review.key_takeaways)) patch.key_takeaways = out
  }
  if (Array.isArray(review.red_flags)) {
    const out = review.red_flags.map((r, i) => {
      if (!r || typeof r !== 'object') return r
      const n = { ...r }
      for (const k of ['flag', 'title', 'detail', 'description']) {
        if (typeof n[k] === 'string') n[k] = fix(n[k], `red_flags[${i}].${k}`)
      }
      return n
    })
    if (JSON.stringify(out) !== JSON.stringify(review.red_flags)) patch.red_flags = out
  }
  if (Array.isArray(review.faq)) {
    const out = review.faq.map((q, i) => {
      if (!q || typeof q !== 'object') return q
      const n = { ...q }
      for (const k of ['question', 'answer']) {
        if (typeof n[k] === 'string') n[k] = fix(n[k], `faq[${i}].${k}`)
      }
      return n
    })
    if (JSON.stringify(out) !== JSON.stringify(review.faq)) patch.faq = out
  }
  // Structured jsonb fields carry the same literals in their text values
  // (dataset.description said "10 celebrities / 240 creatives" on nordiqo;
  // floventra's 12/100 hid in internal_links). Same serialize→fix→parse
  // treatment as schema_json; a parse failure discards the fix.
  for (const jf of ['dataset', 'item_reviewed', 'item_list', 'internal_links', 'quotes', 'claims']) {
    if (!review[jf] || typeof review[jf] !== 'object') continue
    const rawJ = JSON.stringify(review[jf])
    const jLog = []
    let fixedJ = fixScoreLiterals(rawJ, oldScore, newScore, jLog, jf)
    fixedJ = fixMetricLiterals(fixedJ, canon, jLog, jf, { first_detected_date: inv.first_detected_date, last_checked_date: inv.last_checked_date })
    if (fixedJ !== rawJ) {
      try {
        patch[jf] = JSON.parse(fixedJ)
        log.push(...jLog)
      } catch { /* keep the original rather than risk malformed structure */ }
    }
  }

  // item_list completion was tried here and REVERTED: the canonical name
  // list still carries cross-script duplicates for scripts outside the
  // transliteration map (Greek "\u038f\u03bb\u03bf\u03bd \u039c\u03b1\u03c3\u03ba" next to "Elon Musk") and
  // occasional truncated artifacts ("Sophie D"), so mechanically appending
  // the difference would inflate the list with duplicate people. Count
  // mismatches stay flagged for writer regeneration instead.

  // schema_json: textual score literals only. The graph is rebuilt properly at
  // the next generate/polish; this keeps the rendered page self-consistent
  // meanwhile.
  if (review.schema_json) {
    const raw = JSON.stringify(review.schema_json)
    const schemaLog = []
    let fixed = fixScoreLiterals(raw, oldScore, newScore, schemaLog, 'schema_json')
    // Dataset/rating descriptions inside the graph carry metric literals too
    // ("26 days" in the dataset description — deployed-auditor catch,
    // 2026-08-31). The replacements only swap digits and plain words, so the
    // JSON stays valid; the parse below is the safety net regardless.
    fixed = fixMetricLiterals(fixed, canon, schemaLog, 'schema_json', { first_detected_date: inv.first_detected_date, last_checked_date: inv.last_checked_date })
    if (fixed !== raw) {
      try {
        patch.schema_json = JSON.parse(fixed)
        log.push(...schemaLog)
      } catch { /* never ship a corrupt graph for a cosmetic fix */ }
    }
  }

  if (Object.keys(patch).length > 0) {
    const today = new Date().toISOString().slice(0, 10)
    const summaryBits = []
    if (patch.scam_score !== undefined) summaryBits.push(`threat score updated to ${newScore}/100 from live surveillance re-scoring`)
    if (log.some((l) => l.wave === 'B')) summaryBits.push('surveillance metrics reconciled with the canonical record')
    if (log.some((l) => l.wave.startsWith('C'))) summaryBits.push('risk language aligned with the evidence classification')
    patch.update_history = [
      ...(Array.isArray(review.update_history) ? review.update_history : []),
      { date: today, type: 'edited', summary: `Data-consistency remediation: ${summaryBits.join('; ')}.`, actor: 'Crypto Killer editorial tooling' },
    ].slice(-30)
    patch.updated_at = new Date().toISOString()
  }

  const oldBand = oldScore !== null ? classifyThreat(oldScore, brandEvidence(brand)).classification : null
  return {
    log, patch, newScore, oldScore,
    classification: threat.classification,
    bandCrossed: oldBand !== null && oldBand !== threat.classification ? { from: oldBand, to: threat.classification } : null,
  }
}

// ─── main ─────────────────────────────────────────────────────────────────

async function main() {
  const reviews = await rest('/reviews?select=*&order=slug.asc')
  const plans = []
  for (const review of reviews) {
    let brand = null
    if (review.brand_id) {
      const rows = await rest(`/scam_brands?id=eq.${encodeURIComponent(review.brand_id)}&select=*&limit=1`)
      brand = rows[0] || null
    }
    const evidence = EVIDENCE_PATCHES[review.slug]
    if (evidence && brand) {
      brand = { ...brand, ...evidence.patch }
    }
    const plan = { slug: review.slug, id: review.id, status: review.status, brandId: brand?.id || null, ...planReview(review, brand) }
    if (evidence && brand) {
      plan.brandPatch = evidence.patch
      for (const [k, v] of Object.entries(evidence.patch)) {
        plan.log.unshift({ wave: 'D', field: `scam_brands.${k}`, from: '(empty)', to: JSON.stringify(v).slice(0, 100), context: evidence.provenance })
      }
    }
    plans.push(plan)
  }

  const changed = plans.filter((p) => Object.keys(p.patch || {}).length > 0)
  const lines = []
  lines.push(`# Remediation ${APPLY ? 'APPLY' : 'DRY-RUN'} plan — ${new Date().toISOString()}`)
  lines.push('')
  lines.push(`Policy: adopt live brand score; deterministic fixes only (waves A/B/C). ${changed.length} of ${plans.length} investigations change.`)
  lines.push('')
  const tally = {}
  for (const p of plans) for (const l of p.log) tally[l.wave] = (tally[l.wave] || 0) + 1
  lines.push('| Wave | What | Changes |')
  lines.push('|---|---|---:|')
  const WAVE_DESC = { D: 'external corroboration recorded on the brand row (source-traceable, re-verified)', A0: 'scam_score column := live brand score', A1: 'old-score "N/100" literals', A2: 'other threat-score "N/100" literals (context-gated)', B: 'metric literals + stale observation windows → canonical values', 'B-skip': 'day-counts next to unmatchable date windows — left for regeneration', C1: 'fraud assertions → hedged register', C2: 'sub-Elevated "Do not deposit" → verification directive' }
  for (const w of ['D', 'A0', 'A1', 'A2', 'B', 'B-skip', 'C1', 'C2']) lines.push(`| ${w} | ${WAVE_DESC[w]} | ${tally[w] || 0} |`)
  lines.push('')
  const crossers = plans.filter((p) => p.bandCrossed)
  if (crossers.length) {
    lines.push('## ⚠️ Band-crossers — priority queue for Wave-2 regeneration')
    lines.push('')
    lines.push('The new score moves these into a different classification band. Deterministic fixes')
    lines.push('align their numbers and register, but band-specific prose (tier labels baked into')
    lines.push('sentences, verdict framing) needs a writer pass:')
    lines.push('')
    for (const p of crossers) lines.push(`- \`/review/${p.slug}\` — ${p.bandCrossed.from} → ${p.bandCrossed.to} (${p.oldScore} → ${p.newScore})`)
    lines.push('')
  }
  for (const p of plans) {
    if (!p.log.length) continue
    lines.push(`## /review/${p.slug}  (${p.status}; score ${p.oldScore} → ${p.newScore}; ${p.classification})`)
    lines.push('')
    lines.push('| Wave | Field | From | To |')
    lines.push('|---|---|---|---|')
    for (const l of p.log) {
      const cell = (v) => String(v ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ').slice(0, 110)
      lines.push(`| ${l.wave} | \`${l.field}\` | ${cell(l.from)}${l.context ? ` _(${cell(l.context)})_` : ''} | ${cell(l.to)} |`)
    }
    lines.push('')
  }
  const report = lines.join('\n')
  const outIdx = process.argv.indexOf('--out')
  if (outIdx > -1 && process.argv[outIdx + 1]) {
    fs.writeFileSync(process.argv[outIdx + 1], report)
    console.error(`Wrote ${process.argv[outIdx + 1]}`)
  } else if (!APPLY) {
    process.stdout.write(report)
  }

  if (!APPLY) {
    console.error(`\nDRY RUN — nothing written. ${changed.length} reviews would change.`)
    return
  }
  for (const p of plans) {
    if (!p.brandPatch || !p.brandId) continue
    await rest(`/scam_brands?id=eq.${encodeURIComponent(p.brandId)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(p.brandPatch),
    })
    console.error(`applied brand evidence for ${p.slug}: ${Object.keys(p.brandPatch).join(', ')}`)
  }
  for (const p of changed) {
    await rest(`/reviews?id=eq.${encodeURIComponent(p.id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(p.patch),
    })
    console.error(`applied ${p.slug}: ${Object.keys(p.patch).join(', ')}`)
  }
  console.error(`\nAPPLIED to ${changed.length} reviews.`)
}

main().catch((e) => { console.error(e); process.exit(1) })
