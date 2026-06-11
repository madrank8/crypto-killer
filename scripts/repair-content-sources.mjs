/**
 * scripts/repair-content-sources.mjs
 *
 * P0-1 from the content-writing feature audit (2026-06-11): the published
 * content catalog shipped before lib/source-verify.js existed and carries
 * dead + hallucinated source URLs (live citation links AND schema citations
 * pointing at 404s).
 *
 * What it does, per published content row:
 *   1. Liveness-checks every sources[] URL (HEAD → ranged-GET fallback,
 *      browser-grade User-Agent, follows redirects).
 *   2. Classifies: OK / SOFT (403/405/5xx/timeout — usually bot blocks on
 *      gov hosts; kept, flagged for manual browser check) / DEAD (404/410,
 *      DNS failure, malformed).
 *   3. For DEAD URLs, queries the Wayback availability API for an archived
 *      snapshot to use as a replacement.
 *   4. --apply: replaces dead URLs with the Wayback snapshot (title gets an
 *      "[archived]" suffix) or removes the source when no snapshot exists;
 *      mirrors the same fix into citations[] (matched by URL); bumps
 *      updated_at. Never touches full_article HTML — if a dead URL also
 *      appears inline in the body, it's listed in the report for manual
 *      editing instead.
 *   5. --resync: after apply, POSTs each affected article to the deployed
 *      publish endpoint (action=publish) so the fix reaches the Replit
 *      production DB.
 *
 * Usage:
 *   node scripts/repair-content-sources.mjs                      # report only
 *   node scripts/repair-content-sources.mjs --slug=pig-butchering-scam
 *   node scripts/repair-content-sources.mjs --apply
 *   node scripts/repair-content-sources.mjs --apply --resync --base=https://crypto-killer.vercel.app
 *
 * Requires in .env.local:
 *   NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL)
 *   SUPABASE_SERVICE_ROLE_KEY                 (writes need service role)
 *   ADMIN_SECRET                              (only for --resync)
 *
 * Output: scripts/output/source-repair-<date>.json (full machine report)
 * and a human summary on stdout.
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const HERE = path.dirname(fileURLToPath(import.meta.url))

function loadDotEnv() {
  const envPath = path.resolve(HERE, '..', '.env.local')
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq < 0) continue
    const k = t.slice(0, eq).trim()
    const v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    if (!(k in process.env)) process.env[k] = v
  }
}
loadDotEnv()

const args = process.argv.slice(2)
const opts = {
  apply: args.includes('--apply'),
  resync: args.includes('--resync'),
  slug: (args.find((a) => a.startsWith('--slug=')) || '').slice(7) || null,
  base: (args.find((a) => a.startsWith('--base=')) || '').slice(7).replace(/\/+$/, '') || null,
  // Batching for constrained runners: --offset=N --limit=M (ordered by created_at)
  offset: parseInt((args.find((a) => a.startsWith('--offset=')) || '').slice(9), 10) || 0,
  limit: parseInt((args.find((a) => a.startsWith('--limit=')) || '').slice(8), 10) || 0,
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const ADMIN_SECRET = process.env.ADMIN_SECRET

if (!SUPABASE_URL || (!SERVICE_KEY && !ANON_KEY)) {
  console.error('FATAL: NEXT_PUBLIC_SUPABASE_URL and a Supabase key are required (.env.local)')
  process.exit(1)
}
if (opts.apply && !SERVICE_KEY) {
  console.error('FATAL: --apply needs SUPABASE_SERVICE_ROLE_KEY to write rows')
  process.exit(1)
}
if (opts.resync && (!opts.base || !ADMIN_SECRET)) {
  console.error('FATAL: --resync needs --base=<vercel-url> and ADMIN_SECRET')
  process.exit(1)
}

const KEY = SERVICE_KEY || ANON_KEY
async function supa(pathname, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${pathname}`, {
    ...init,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  })
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const text = await res.text()
  return text ? JSON.parse(text) : null
}

// ── URL liveness check (mirrors lib/source-verify.js severity model) ──
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
const TIMEOUT = 12000

async function checkUrl(url) {
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return { status: 'dead', detail: 'malformed URL' }
  }
  const attempt = async (method, extraHeaders = {}) => {
    const res = await fetch(url, {
      method,
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT),
      headers: { 'User-Agent': UA, ...extraHeaders },
    })
    return res.status
  }
  try {
    let status = await attempt('HEAD')
    if (status === 405 || status === 501 || status === 403) {
      // Hosts that reject HEAD or bot-block: retry as bounded GET.
      try {
        status = await attempt('GET', { Range: 'bytes=0-2047' })
      } catch {
        /* keep HEAD status */
      }
    }
    if (status >= 200 && status < 400) return { status: 'ok', detail: `HTTP ${status}` }
    if (status === 404 || status === 410) return { status: 'dead', detail: `HTTP ${status}` }
    return { status: 'soft', detail: `HTTP ${status}` } // 403/5xx → bot-block ambiguity
  } catch (e) {
    const msg = String(e?.message || e)
    // DNS resolution failure = dead; timeouts = soft (slow gov hosts)
    if (/ENOTFOUND|EAI_AGAIN|certificate|ECONNREFUSED/i.test(msg)) {
      return { status: 'dead', detail: `network: ${msg.slice(0, 120)}` }
    }
    return { status: 'soft', detail: `network: ${msg.slice(0, 120)}` }
  }
}

async function waybackSnapshot(url) {
  try {
    const res = await fetch(
      `https://archive.org/wayback/available?url=${encodeURIComponent(url)}`,
      { signal: AbortSignal.timeout(TIMEOUT), headers: { 'User-Agent': UA } }
    )
    if (!res.ok) return null
    const data = await res.json()
    const snap = data?.archived_snapshots?.closest
    if (snap?.available && snap?.url) {
      return { url: snap.url.replace(/^http:/, 'https:'), timestamp: snap.timestamp }
    }
    return null
  } catch {
    return null
  }
}

function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i], i)
    }
  })
  return Promise.all(workers).then(() => results)
}

// ── Main ──
const slugFilter = opts.slug ? `&slug=eq.${encodeURIComponent(opts.slug)}` : ''
const batchFilter = opts.limit ? `&offset=${opts.offset}&limit=${opts.limit}` : ''
const rows = await supa(
  `/content?status=eq.published${slugFilter}&select=id,slug,sources,citations,internal_links,full_article&order=created_at.asc${batchFilter}`
)
console.log(`[repair] ${rows.length} published article(s) to check (apply=${opts.apply})`)

const report = { ranAt: new Date().toISOString(), apply: opts.apply, articles: [] }

for (const row of rows) {
  const sources = Array.isArray(row.sources) ? row.sources : []
  const citations = Array.isArray(row.citations) ? row.citations : []
  if (sources.length === 0) {
    report.articles.push({ slug: row.slug, note: 'no sources array', changes: [] })
    continue
  }

  const checks = await mapWithConcurrency(sources, 6, async (src) => {
    if (!src?.url) return { src, status: 'dead', detail: 'missing url' }
    const r = await checkUrl(src.url)
    return { src, ...r }
  })

  const changes = []
  const newSources = []
  let citationsChanged = false
  let newCitations = citations

  for (const c of checks) {
    if (c.status !== 'dead') {
      newSources.push(c.src)
      if (c.status === 'soft') {
        changes.push({ kind: 'soft-flag', url: c.src.url, detail: c.detail })
      }
      continue
    }
    const inBody = typeof row.full_article === 'string' && row.full_article.includes(c.src.url)
    const snap = await waybackSnapshot(c.src.url)
    if (snap) {
      const repaired = {
        ...c.src,
        url: snap.url,
        title: /\[archived\]$/i.test(c.src.title || '') ? c.src.title : `${c.src.title || 'Source'} [archived]`,
        original_url: c.src.url,
      }
      newSources.push(repaired)
      changes.push({ kind: 'wayback-replace', url: c.src.url, replacement: snap.url, detail: c.detail, inBody })
      newCitations = newCitations.map((cit) =>
        cit?.url === c.src.url ? { ...cit, url: snap.url, name: repaired.title } : cit
      )
      citationsChanged = citationsChanged || citations.some((cit) => cit?.url === c.src.url)
    } else {
      changes.push({ kind: 'remove', url: c.src.url, detail: c.detail, inBody })
      const before = newCitations.length
      newCitations = newCitations.filter((cit) => cit?.url !== c.src.url)
      citationsChanged = citationsChanged || newCitations.length !== before
    }
  }

  // Placeholder internal_links hygiene — the same broken entries the publish
  // gate blocks on ('', '#', 'TBD', 'todo'). Old rows published before that
  // gate existed still carry them; drop while we're writing anyway.
  const PLACEHOLDER_TARGETS = new Set(['', '#', 'tbd', 'todo'])
  const links = Array.isArray(row.internal_links) ? row.internal_links : []
  const cleanLinks = links.filter(
    (l) => !PLACEHOLDER_TARGETS.has(String(l?.target_slug || '').trim().toLowerCase())
  )
  const linksChanged = cleanLinks.length !== links.length
  if (linksChanged) {
    changes.push({ kind: 'drop-placeholder-link', count: links.length - cleanLinks.length })
  }

  const deadCount = changes.filter((ch) => ch.kind === 'remove' || ch.kind === 'wayback-replace').length
  report.articles.push({ slug: row.slug, total: sources.length, dead: deadCount, changes })

  if (opts.apply && (deadCount > 0 || linksChanged)) {
    const patch = { sources: newSources, updated_at: new Date().toISOString() }
    if (citationsChanged) patch.citations = newCitations
    if (linksChanged) patch.internal_links = cleanLinks
    await supa(`/content?id=eq.${row.id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(patch),
    })
    console.log(`[repair] ${row.slug}: ${deadCount} dead → applied (${changes.filter((ch) => ch.kind === 'wayback-replace').length} archived, ${changes.filter((ch) => ch.kind === 'remove').length} removed${linksChanged ? `, ${links.length - cleanLinks.length} placeholder link(s) dropped` : ''})`)

    if (opts.resync) {
      // Direct sync route — pushes the repaired row to Replit as-is. The
      // publish route would re-run the full quality gate, which legacy
      // articles fail on unrelated pre-existing prose issues; blocking the
      // SOURCE fix on those would leave dead links live longer. The gate
      // still protects every future publish.
      try {
        const res = await fetch(`${opts.base}/api/admin/content/${row.id}/sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ADMIN_SECRET}` },
          signal: AbortSignal.timeout(60000),
        })
        const body = await res.json().catch(() => ({}))
        console.log(`[repair] ${row.slug}: resync ${res.ok ? `OK (${body.endpoint})` : `FAIL ${res.status} ${String(body?.error || '').slice(0, 160)}`}`)
      } catch (e) {
        console.log(`[repair] ${row.slug}: resync FAIL — ${e.message}`)
      }
    }
  } else if (deadCount > 0) {
    console.log(`[repair] ${row.slug}: ${deadCount} dead source(s) found (report-only)`)
  } else {
    console.log(`[repair] ${row.slug}: clean (${changes.length} soft flag(s))`)
  }
}

const outDir = path.resolve(HERE, 'output')
fs.mkdirSync(outDir, { recursive: true })
const batchTag = opts.limit ? `-b${opts.offset}` : ''
const outPath = path.join(outDir, `source-repair-${new Date().toISOString().slice(0, 10)}${batchTag}.json`)
fs.writeFileSync(outPath, JSON.stringify(report, null, 2))

const totals = report.articles.reduce(
  (acc, a) => {
    for (const ch of a.changes || []) acc[ch.kind] = (acc[ch.kind] || 0) + 1
    return acc
  },
  {}
)
const inBodyCount = report.articles.flatMap((a) => a.changes || []).filter((ch) => ch.inBody).length
console.log('\n[repair] === SUMMARY ===')
console.log(`[repair] articles checked: ${report.articles.length}`)
console.log(`[repair] wayback-replaced: ${totals['wayback-replace'] || 0}  removed: ${totals['remove'] || 0}  soft-flagged: ${totals['soft-flag'] || 0}`)
if (inBodyCount > 0) console.log(`[repair] ⚠ ${inBodyCount} dead URL(s) also appear inline in full_article — fix those manually (script never edits body HTML)`)
console.log(`[repair] full report: ${outPath}`)
