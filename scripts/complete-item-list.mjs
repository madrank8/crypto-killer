#!/usr/bin/env node
// Post-regeneration item_list alignment for ONE review (Wave-2 fleet step).
//
// v2 (2026-08-31): CANONICAL ALIGNMENT, not conservative append.
// The deployed polish auditor's "CELEBRITY NAMES ground truth" is exactly
// dedupeCelebrityList(brand.celebrity_list) — including non-Latin names
// verbatim for pairs KNOWN_NAME_PAIRS doesn't map. So the correct item_list
// is that canonical projection itself: every name is traceable to the
// brand's celebrity_list by construction, cross-script dupes are removed by
// the same map the auditor uses, and counts match by definition. The old
// provable-Latin-only append left permanent count-gap vetoes (prestara-nexor
// 7/26, primeaura 148/166, trade-vector-ai 71/136) that this closes.
//
// Existing item objects are preserved (descriptions survive); only names
// absent from the canonical roster are dropped and missing ones added.
// Skipped when the roster is truncated (public_figure_list_complete=false):
// aligning to an incomplete roster would understate the observed count.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { buildInvestigation } = require('../lib/investigation-model.js')
const { dedupeCelebrityList } = require('../lib/threat-score.js')

for (const line of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
const U = process.env.NEXT_PUBLIC_SUPABASE_URL
const K = process.env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' }
const slug = process.argv[2]
if (!slug) { console.error('usage: complete-item-list.mjs <slug>'); process.exit(1) }

const [review] = await (await fetch(`${U}/rest/v1/reviews?slug=eq.${slug}&select=*`, { headers: H })).json()
const [brand] = await (await fetch(`${U}/rest/v1/scam_brands?id=eq.${review.brand_id}&select=*`, { headers: H })).json()
const inv = buildInvestigation({ review, brand })
const il = review.item_list
if (!il || !Array.isArray(il.items) || !inv.public_figure_list_complete) { console.log('no completion applicable'); process.exit(0) }

let celebrityList = brand.celebrity_list
if (typeof celebrityList === 'string') { try { celebrityList = JSON.parse(celebrityList) } catch { celebrityList = [] } }
const canon = dedupeCelebrityList(Array.isArray(celebrityList) ? celebrityList : [])
if (canon.length === 0) { console.log('no canonical roster'); process.exit(0) }

const byName = new Map()
for (const it of il.items) {
  const n = typeof it === 'string' ? it : it?.name
  if (n) byName.set(n, typeof it === 'string' ? { name: it } : it)
}
const items = canon.map((name, i) => ({
  description: `Public figure whose likeness appeared in ${inv.brand_name} advertising captured by CryptoKiller surveillance.`,
  ...(byName.get(name) || {}),
  name,
  position: i + 1,
}))
const before = il.items.length
if (before === items.length && il.items.every((it, i) => (typeof it === 'string' ? it : it?.name) === items[i].name)) {
  console.log('item_list already canonical')
  process.exit(0)
}
const patch = { item_list: { ...il, items, numberOfItems: items.length } }
const res = await fetch(`${U}/rest/v1/reviews?id=eq.${review.id}`, { method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify(patch) })
console.log(`item_list: ${before} → ${items.length} canonical (status ${res.status})`)
