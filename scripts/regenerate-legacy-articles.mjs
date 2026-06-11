/**
 * scripts/regenerate-legacy-articles.mjs
 *
 * P0-3 from the content-writing feature audit (2026-06-11): 9 published
 * articles were written by the legacy monolithic writer — no v2 schema
 * enrichment, no pipeline diagnostics, pre-anti-slop prose, and (post
 * source-repair) dead URLs still inline in body HTML.
 *
 * For each article this driver runs the modern path end-to-end against the
 * DEPLOYED Vercel app (so the current model pins + verified-source outline
 * + 4-stage fill pipeline + publish gates all apply):
 *
 *   1. POST /api/admin/content/outline  (SSE, ≤120s) — fresh research with
 *      verifySourceLedger, overwrites sections/faq/sources on the row
 *   2. POST /api/admin/content/fill     (SSE, ≤300s) — 4-stage pipeline,
 *      visuals, v2 schema enrichment, audit
 *   3. POST /api/admin/content/[id]/publish {action:'publish'} — runs the
 *      hardened quality gate; on pass, re-syncs to the Replit live site
 *
 * Articles run SEQUENTIALLY (each fill fans out parallel Opus calls
 * server-side already; running articles in parallel would stack model
 * load and Vercel concurrency for no wall-time benefit you'd notice).
 *
 * Usage:
 *   node scripts/regenerate-legacy-articles.mjs --base=https://crypto-killer.vercel.app
 *   node scripts/regenerate-legacy-articles.mjs --base=... --slug=pig-butchering-scam
 *   node scripts/regenerate-legacy-articles.mjs --base=... --skip-outline   # fill+publish only
 *   node scripts/regenerate-legacy-articles.mjs --base=... --dry-run
 *
 * Requires ADMIN_SECRET in .env.local. Expect ~3-6 minutes per article.
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

// The 9 legacy articles (ai_audit without pipeline_stages), queried
// 2026-06-11. NOTE: 'ai-deepfake-crypto-scams-a-2026-guide-to-safety' is
// EXCLUDED by default — it shares topic 79eedaa5 with
// 'ai-deepfake-crypto-scams-2026-safety-guide' (duplicate article on the
// same topic). Regenerating both would produce near-identical pages
// (cross-document sameness). Decide its fate (unpublish + redirect, or
// re-point to its own topic) before regenerating it; run with
// --slug=ai-deepfake-crypto-scams-a-2026-guide-to-safety to force it.
const LEGACY = [
  { id: 'a63eac93-59f3-46b8-8715-6e19c6e27a56', slug: 'ai-deepfake-crypto-scams-2026-safety-guide' },
  { id: 'fc9fc45a-0d51-4347-afe9-49ac43e559ca', slug: 'ai-crypto-trading-bot-scam' },
  { id: 'b0ba8fa5-d1c9-4e55-bb02-278bd77fae4f', slug: 'fake-trading-profits' },
  { id: 'b7404079-4b0a-4a31-aa54-60fc1515ea20', slug: 'how-to-spot-crypto-scams' },
  { id: 'db65809f-9f84-4c71-8398-b92420043fd6', slug: 'celebrity-crypto-scam' },
  { id: '8652fc51-f1c5-42a8-a3bd-1001218c4d63', slug: 'how-to-spot-a-deepfake' },
  { id: '2575ee8a-cd5b-45f9-b616-6b6ec52f4e4f', slug: 'pig-butchering-scam' },
  { id: '212690be-7c47-4f17-851a-3708f60ef4ca', slug: 'celebrities-promoting-crypto-scams' },
]
const DUPLICATE_HELD_OUT = { id: '9dd327b2-a804-4773-8b27-69b54611d16c', slug: 'ai-deepfake-crypto-scams-a-2026-guide-to-safety' }

const args = process.argv.slice(2)
const opts = {
  base: (args.find((a) => a.startsWith('--base=')) || '').slice(7).replace(/\/+$/, ''),
  slug: (args.find((a) => a.startsWith('--slug=')) || '').slice(7) || null,
  skipOutline: args.includes('--skip-outline'),
  dryRun: args.includes('--dry-run'),
}
const ADMIN_SECRET = process.env.ADMIN_SECRET

if (!opts.base || !ADMIN_SECRET) {
  console.error('FATAL: --base=<vercel-url> and ADMIN_SECRET (.env.local) are required')
  process.exit(1)
}

let queue = LEGACY
if (opts.slug) {
  queue = [...LEGACY, DUPLICATE_HELD_OUT].filter((a) => a.slug === opts.slug)
  if (queue.length === 0) {
    console.error(`FATAL: --slug=${opts.slug} is not in the legacy list`)
    process.exit(1)
  }
}

console.log(`[regen] ${queue.length} article(s) queued (skipOutline=${opts.skipOutline}, dryRun=${opts.dryRun})`)
console.log(`[regen] held out (duplicate topic): ${DUPLICATE_HELD_OUT.slug} — decide unpublish/redirect separately\n`)

/**
 * POST to an SSE route and consume the stream to completion.
 * Returns { ok, lastEvents, error } — lastEvents holds the final few parsed
 * events so failures are diagnosable from the log.
 */
async function runSse(pathname, body, { timeoutMs, label }) {
  const startedAt = Date.now()
  const events = []
  try {
    const res = await fetch(`${opts.base}${pathname}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ADMIN_SECRET}`,
        Accept: 'text/event-stream',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '')
      return { ok: false, error: `HTTP ${res.status} ${text.slice(0, 300)}`, events }
    }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let idx
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const chunk = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 2)
        const dataLine = chunk.split('\n').find((l) => l.startsWith('data: '))
        if (!dataLine) continue
        try {
          const ev = JSON.parse(dataLine.slice(6))
          events.push(ev)
          if (ev.step && ev.message) {
            process.stdout.write(`         [${label}] ${ev.progress ?? '?'}% ${ev.step}: ${String(ev.message).slice(0, 110)}\n`)
          }
        } catch { /* partial/non-JSON event */ }
      }
    }
    const durS = Math.round((Date.now() - startedAt) / 1000)
    const last = events[events.length - 1] || {}
    const failed = events.some((e) => e.step === 'error' || e.error)
    return failed
      ? { ok: false, error: `stream reported error: ${JSON.stringify(events.filter((e) => e.step === 'error' || e.error).slice(-1)[0]).slice(0, 300)}`, events, durS }
      : { ok: true, last, events, durS }
  } catch (e) {
    return { ok: false, error: e.message, events }
  }
}

const results = []
for (const item of queue) {
  console.log(`\n[regen] ━━━ ${item.slug} ━━━`)
  if (opts.dryRun) { results.push({ slug: item.slug, status: 'dry-run' }); continue }

  // 1. Outline (fresh research + verified ledger)
  if (!opts.skipOutline) {
    const outline = await runSse('/api/admin/content/outline', { content_id: item.id }, { timeoutMs: 150000, label: 'outline' })
    if (!outline.ok) {
      console.log(`[regen] ${item.slug}: OUTLINE FAILED — ${outline.error}`)
      results.push({ slug: item.slug, status: 'outline-failed', error: outline.error })
      continue
    }
    console.log(`[regen] ${item.slug}: outline OK (${outline.durS}s)`)
  }

  // 2. Fill (4-stage pipeline + visuals + enrichment)
  const fill = await runSse('/api/admin/content/fill', { content_id: item.id }, { timeoutMs: 330000, label: 'fill' })
  if (!fill.ok) {
    console.log(`[regen] ${item.slug}: FILL FAILED — ${fill.error}`)
    results.push({ slug: item.slug, status: 'fill-failed', error: fill.error })
    continue
  }
  console.log(`[regen] ${item.slug}: fill OK (${fill.durS}s)`)

  // 3. Publish (hardened gate + Replit sync)
  try {
    const res = await fetch(`${opts.base}/api/admin/content/${item.id}/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ADMIN_SECRET}` },
      body: JSON.stringify({ action: 'publish' }),
      signal: AbortSignal.timeout(120000),
    })
    const data = await res.json().catch(() => ({}))
    if (res.ok) {
      console.log(`[regen] ${item.slug}: PUBLISHED + synced (live_sync: ${data?.live_sync?.success})`)
      results.push({ slug: item.slug, status: 'published', warnings: data?.warnings || [] })
    } else {
      console.log(`[regen] ${item.slug}: PUBLISH GATE BLOCKED (${res.status})`)
      for (const r of data?.reasons || []) console.log(`         ✗ ${r}`)
      results.push({ slug: item.slug, status: 'gate-blocked', reasons: data?.reasons || [] })
    }
  } catch (e) {
    console.log(`[regen] ${item.slug}: PUBLISH FAILED — ${e.message}`)
    results.push({ slug: item.slug, status: 'publish-failed', error: e.message })
  }
}

console.log('\n[regen] === SUMMARY ===')
for (const r of results) {
  console.log(`[regen] ${r.status.padEnd(16)} ${r.slug}${r.error ? ` — ${String(r.error).slice(0, 140)}` : ''}${r.reasons ? ` — ${r.reasons.length} gate reason(s)` : ''}`)
}
const outDir = path.resolve(HERE, 'output')
fs.mkdirSync(outDir, { recursive: true })
const outPath = path.join(outDir, `regenerate-legacy-${new Date().toISOString().slice(0, 10)}.json`)
fs.writeFileSync(outPath, JSON.stringify({ ranAt: new Date().toISOString(), results }, null, 2))
console.log(`[regen] report: ${outPath}`)
