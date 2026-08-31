#!/usr/bin/env node
/**
 * scripts/fix-claims-pass3.mjs — one-off, 2026-08-31 (post-Polish cycle 1).
 *
 * Per-review surgical fixes for claims the deployed auditor flagged, each
 * resolved by VERIFICATION first (every attached URL fetched live today):
 *  - whatsapp-bot: SEC $14M WhatsApp case → SEC press release 2025-144 (real);
 *    "Kyle Holder $300,000" → CBS News 2026-04-23 (real victim, WhatsApp scam).
 *  - floventra / nordiqo / prestara-nexor: the regulator registers the prose
 *    says were checked get their canonical URLs in the Source Ledger.
 *  - floventra ES[3]: "dropped from active to 61 creatives per week" —
 *    incoherent after an earlier bad literal fix (the original "57/week" was
 *    itself contradicted by velocity_7d=0). Rewritten against canonical data.
 *  - affitto ES[3]: "velocity dropped to zero after 26 days" contradicted by
 *    the brand's 153-day activity span. The unsupported clause is removed;
 *    the supported infrastructure observation stays.
 *  - nordiqo: three unverifiable pattern specifics softened to category level.
 * Every text edit requires EXACTLY one match or is skipped loudly.
 */
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

const REGISTERS = {
  fca_register: { url: 'https://register.fca.org.uk/', title: 'FCA Financial Services Register', pub: 'Financial Conduct Authority' },
  fca_warnings: { url: 'https://www.fca.org.uk/consumers/warning-list-unauthorised-firms', title: 'FCA Warning List (unauthorised firms)', pub: 'Financial Conduct Authority' },
  asic_alerts: { url: 'https://moneysmart.gov.au/check-and-report-scams/investor-alert-list', title: 'ASIC Moneysmart Investor Alert List', pub: 'Australian Securities and Investments Commission' },
  finma: { url: 'https://www.finma.ch/en/finma-public/warnungen/', title: 'FINMA warning list', pub: 'Swiss Financial Market Supervisory Authority FINMA' },
  sfc: { url: 'https://www.sfc.hk/en/alert-list', title: 'SFC Alert List (Hong Kong)', pub: 'Securities and Futures Commission' },
  ic3: { url: 'https://www.ic3.gov/', title: 'FBI Internet Crime Complaint Center (IC3)', pub: 'Federal Bureau of Investigation' },
  action_fraud: { url: 'https://www.actionfraud.police.uk/', title: 'Action Fraud (UK national fraud reporting centre)', pub: 'City of London Police' },
  adcc: { url: 'https://www.adcc.gov.hk/en-hk/home.html', title: 'Anti-Deception Coordination Centre (Hong Kong Police)', pub: 'Hong Kong Police Force' },
  ipqs: { url: 'https://www.ipqualityscore.com/', title: 'IPQualityScore domain/phishing reputation checker', pub: 'IPQualityScore' },
}
const src = (k) => ({ url: REGISTERS[k].url, type: 'regulatory', title: `${REGISTERS[k].title} (register check)`, accessed_date: TODAY })
const cit = (k) => ({ url: REGISTERS[k].url, name: REGISTERS[k].title, type: 'GovernmentService', publisher: REGISTERS[k].pub })

const PLANS = {
  'whatsapp-bot': {
    addSources: [
      { url: 'https://www.sec.gov/newsroom/press-releases/2025-144-sec-charges-three-purported-crypto-asset-trading-platforms-four-investment-clubs-scheme-targeted', type: 'regulatory', title: 'SEC press release 2025-144 (22 Dec 2025): $14M WhatsApp-group crypto scheme charges', accessed_date: TODAY },
      { url: 'https://www.cbsnews.com/news/ai-crypto-fraud-irs-investigators/', type: 'news', title: 'CBS News (23 Apr 2026): Kyle Holder, 73, lost $300,000 to a WhatsApp crypto scam', accessed_date: TODAY },
    ],
    addCitations: [
      { url: 'https://www.sec.gov/newsroom/press-releases/2025-144-sec-charges-three-purported-crypto-asset-trading-platforms-four-investment-clubs-scheme-targeted', name: 'SEC 2025-144: WhatsApp-group crypto scheme charges ($14M)', type: 'GovernmentService', publisher: 'U.S. Securities and Exchange Commission' },
      { url: 'https://www.cbsnews.com/news/ai-crypto-fraud-irs-investigators/', name: 'CBS News: AI crypto fraud investigation (Kyle Holder case)', type: 'NewsArticle', publisher: 'CBS News' },
    ],
    historyNote: 'Sourced the SEC $14M WhatsApp-scheme case (SEC 2025-144) and the Kyle Holder $300,000 loss (CBS News, 23 Apr 2026) with verified URLs.',
  },
  'floventra': {
    addSources: [src('fca_register'), src('asic_alerts'), src('finma')],
    addCitations: [cit('fca_register'), cit('asic_alerts'), cit('finma')],
    edits: [{
      fields: ['experience_signals'],
      from: 'Campaign velocity dropped from active to 61 creatives per week between mid-April and late April 2026, a pattern we observe when operators exhaust ad budgets or face platform takedowns.',
      to: 'Campaign velocity fell away sharply in late April 2026 — the most recent 7-day window shows no new creatives — a pattern we observe when operators exhaust ad budgets or face platform takedowns.',
    }],
    historyNote: 'Added register URLs for the FCA, ASIC and FINMA checks cited in the methodology; corrected an internally inconsistent velocity claim against current surveillance data.',
  },
  'affitto-casa-immobiliare': {
    addSources: [],
    addCitations: [],
    edits: [{
      fields: ['experience_signals'],
      from: 'Ad velocity dropped to zero after 26 days, consistent with a burn-and-rotate pattern where operators abandon domains before platform enforcement catches up.',
      to: 'The campaign shows a burn-and-rotate domain pattern, with landing domains abandoned before platform enforcement catches up.',
    }],
    historyNote: 'Removed a velocity claim contradicted by the campaign’s own activity span; the supported infrastructure observation stands.',
  },
  'nordiqo': {
    addSources: [src('fca_register'), src('fca_warnings'), src('asic_alerts'), src('ipqs'), src('action_fraud'), src('ic3')],
    addCitations: [cit('fca_register'), cit('fca_warnings'), cit('asic_alerts'), cit('ipqs'), cit('action_fraud'), cit('ic3')],
    edits: [
      {
        fields: ['full_article'],
        from: 'who pressures the target to make an initial deposit, often starting at $250.',
        to: 'who pressures the target to make an initial deposit, typically a few hundred dollars.',
      },
      {
        fields: ['how_it_works', 'full_article'],
        from: 'display fabricated portfolio dashboards showing rapid gains — sometimes 300-500% within days.',
        to: 'display fabricated portfolio dashboards showing rapid multi-fold gains within days.',
      },
      {
        fields: ['full_article'],
        from: '>$500–$5k</p>',
        to: '>Escalating</p>',
        fromAlt: '>$500–$5k</p>',
      },
    ],
    historyNote: 'Added register URLs for the FCA, ASIC, IPQS, Action Fraud and IC3 checks cited in prose; softened three pattern-level dollar/return specifics that no stored evidence backs.',
  },
  'prestara-nexor': {
    addSources: [src('fca_register'), src('fca_warnings'), src('asic_alerts'), src('sfc'), src('ic3'), src('adcc'), src('action_fraud')],
    addCitations: [cit('fca_register'), cit('fca_warnings'), cit('asic_alerts'), cit('sfc'), cit('ic3'), cit('adcc'), cit('action_fraud')],
    historyNote: 'Added register URLs for the FCA, ASIC, SFC, IC3, ADCC and Action Fraud checks cited in prose.',
  },
}

const count = (h, n) => h.split(n).length - 1
for (const [slug, plan] of Object.entries(PLANS)) {
  const [review] = await rest(`/reviews?slug=eq.${slug}&select=*`)
  if (!review) throw new Error(`${slug} not found`)
  const patch = {}
  for (const e of plan.edits || []) {
    for (const f of e.fields) {
      const isArray = Array.isArray(review[f])
      let text = patch[f] !== undefined ? (isArray ? JSON.stringify(patch[f]) : patch[f]) : (isArray ? JSON.stringify(review[f]) : review[f])
      if (typeof text !== 'string') continue
      let needle = e.from
      if (isArray) needle = JSON.stringify(e.from).slice(1, -1)
      if (count(text, needle) === 0 && e.fromAlt) needle = isArray ? JSON.stringify(e.fromAlt).slice(1, -1) : e.fromAlt
      const n = count(text, needle)
      if (n !== 1) { console.error(`SKIP ${slug}.${f}: ${n} matches for: ${String(needle).slice(0, 70)}`); continue }
      const replacement = isArray ? JSON.stringify(e.to).slice(1, -1) : e.to
      const fixed = text.split(needle).join(replacement)
      patch[f] = isArray ? JSON.parse(fixed) : fixed
      console.log(`edit ${slug}.${f} ok`)
    }
  }
  const dedupe = (arr, key) => { const s2 = new Set(); return arr.filter((x) => (s2.has(x[key]) ? false : (s2.add(x[key]), true))) }
  if (plan.addSources.length) patch.sources = dedupe([...(review.sources || []), ...plan.addSources], 'url')
  if (plan.addCitations.length) patch.citations = dedupe([...(review.citations || []), ...plan.addCitations], 'url')
  patch.update_history = [...(review.update_history || []), { date: TODAY, type: 'edited', summary: plan.historyNote, actor: 'Crypto Killer editorial tooling' }].slice(-30)
  patch.updated_at = new Date().toISOString()
  await rest(`/reviews?id=eq.${review.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(patch) })
  console.log(`patched ${slug}: [${Object.keys(patch).join(',')}]`)
}
console.log('DONE')
