#!/usr/bin/env node
// One-off micro-fixes for the cycle-2 auditor residuals (2026-08-31).
import fs from 'node:fs'
import path from 'node:path'
for (const line of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
const U = process.env.NEXT_PUBLIC_SUPABASE_URL
const K = process.env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' }
const rest = async (p, init = {}) => {
  const r = await fetch(`${U}/rest/v1${p}`, { ...init, headers: { ...H, ...(init.headers || {}) } })
  if (!r.ok) throw new Error(`${r.status} on ${p}: ${await r.text()}`)
  return r.status === 204 ? null : r.json()
}
const TODAY = '2026-08-31'
const count = (h, n) => h.split(n).length - 1

// Serialized-field editor: replaceAll=false demands exactly one match.
function editField(review, patch, field, from, to, { all = false } = {}) {
  const isObj = typeof review[field] === 'object' && review[field] !== null
  const base = patch[field] !== undefined ? patch[field] : review[field]
  const text = isObj ? JSON.stringify(base) : base
  if (typeof text !== 'string') return console.error(`SKIP ${field}: not text`)
  const needle = isObj ? JSON.stringify(from).slice(1, -1) : from
  const repl = isObj ? JSON.stringify(to).slice(1, -1) : to
  const n = count(text, needle)
  if (n === 0 || (!all && n !== 1)) return console.error(`SKIP ${field}: ${n} matches for ${String(from).slice(0, 60)}`)
  const fixed = text.split(needle).join(repl)
  patch[field] = isObj ? JSON.parse(fixed) : fixed
  console.log(`edit ${field} ×${n} ok`)
}

const WAYBACK = [
  { url: 'https://web.archive.org/web/20260424104238/https://advance-commerce-system.top/', title: 'Wayback snapshot (24 Apr 2026): advance-commerce-system.top landing page', host: 'advance-commerce-system.top' },
  { url: 'https://web.archive.org/web/20260424104232/https://efficient-marketing-engine.art/', title: 'Wayback snapshot (24 Apr 2026): efficient-marketing-engine.art landing page', host: 'efficient-marketing-engine.art' },
  { url: 'https://web.archive.org/web/20260424104226/https://profit-marketing-platform.top/', title: 'Wayback snapshot (24 Apr 2026): profit-marketing-platform.top landing page', host: 'profit-marketing-platform.top' },
]

const dedupe = (arr, key) => { const s = new Set(); return arr.filter((x) => (s.has(x[key]) ? false : (s.add(x[key]), true))) }

// ── primeaura: the Crypto Legal sentence also lives in red_flags ──────────
{
  const [r] = await rest(`/reviews?slug=eq.primeaura&select=*`)
  const patch = {}
  editField(r, patch, 'red_flags', " Crypto Legal's fraud database lists primeaura.cfd.", '')
  patch.update_history = [...(r.update_history || []), { date: TODAY, type: 'edited', summary: 'Removed the unverifiable Crypto Legal citation from the domain-infrastructure red flag (no such listing found on cryptolegal.uk, checked 2026-08-31).', actor: 'Crypto Killer editorial tooling' }].slice(-30)
  patch.updated_at = new Date().toISOString()
  await rest(`/reviews?id=eq.${r.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(patch) })
  console.log('patched primeaura')
}

// ── quarix-ai: soften two pattern specifics; attach the Wayback evidence ──
{
  const [r] = await rest(`/reviews?slug=eq.quarix-ai&select=*`)
  const patch = {}
  editField(r, patch, 'how_it_works', 'showing returns of 200-500% within days.', 'showing implausibly rapid multi-fold returns within days.')
  editField(r, patch, 'full_article', 'showing returns of 200-500% within days.', 'showing implausibly rapid multi-fold returns within days.', { all: true })
  editField(r, patch, 'full_article', 'the 60-day dispute window is strict', 'dispute windows are strict and vary by card network', { all: true })
  editField(r, patch, 'faq', 'the 60-day dispute window is strict', 'dispute windows are strict and vary by card network', { all: true })
  patch.sources = dedupe([...(r.sources || []), ...WAYBACK.map((w) => ({ url: w.url, type: 'evidence', title: w.title, accessed_date: TODAY }))], 'url')
  patch.citations = dedupe([...(r.citations || []), ...WAYBACK.map((w) => ({ url: w.url, name: w.title, type: 'ArchiveComponent', publisher: 'Internet Archive Wayback Machine' }))], 'url')
  patch.update_history = [...(r.update_history || []), { date: TODAY, type: 'edited', summary: 'Attached the three Wayback landing-page snapshots as evidence sources; softened two pattern-level figures (return range, card-dispute window) that no stored evidence backs.', actor: 'Crypto Killer editorial tooling' }].slice(-30)
  patch.updated_at = new Date().toISOString()
  await rest(`/reviews?id=eq.${r.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(patch) })
  console.log('patched quarix-ai')
}

// ── trade-vector-ai: sample-size phrasing + ASIC register source ─────────
{
  const [r] = await rest(`/reviews?slug=eq.trade-vector-ai&select=*`)
  const patch = {}
  editField(r, patch, 'experience_signals', 'across 8 sampled ads', 'across the sampled Slovak-language ads')
  patch.sources = dedupe([...(r.sources || []), { url: 'https://moneysmart.gov.au/check-and-report-scams/investor-alert-list', type: 'regulatory', title: 'ASIC Moneysmart Investor Alert List (register check)', accessed_date: TODAY }], 'url')
  patch.citations = dedupe([...(r.citations || []), { url: 'https://moneysmart.gov.au/check-and-report-scams/investor-alert-list', name: 'ASIC Moneysmart Investor Alert List', type: 'GovernmentService', publisher: 'Australian Securities and Investments Commission' }], 'url')
  patch.update_history = [...(r.update_history || []), { date: TODAY, type: 'edited', summary: 'Added the ASIC investor-alert register URL for the red-flag register check; reworded a sample-size figure the ledger does not itemise.', actor: 'Crypto Killer editorial tooling' }].slice(-30)
  patch.updated_at = new Date().toISOString()
  await rest(`/reviews?id=eq.${r.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(patch) })
  console.log('patched trade-vector-ai')
}
console.log('DONE')
