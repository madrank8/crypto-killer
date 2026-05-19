/**
 * scripts/backfill-celebrity-name.mjs
 *
 * One-shot backfill: re-derives creatives.celebrity_name for rows where
 * SpyOwl's celebrityName field came back empty and the celebrity was
 * embedded in offerName (e.g. "Senvix Robert Benton" → "Robert Benton").
 *
 * Why a standalone script and not a route: 49k rows × per-row HTTP would
 * blow past Vercel's 300s function ceiling. Run locally against the
 * production database with the service-role key.
 *
 * Safety:
 *   - Touches celebrity_name only — does NOT use upsert_creatives RPC,
 *     because that RPC bumps last_seen_at and scrape_count on every
 *     conflict (would pollute brand freshness/velocity rollups).
 *   - Direct UPDATE via PostgREST PATCH /creatives?id=eq.<id>.
 *   - --dry-run mode prints 20 before/after pairs and exits without
 *     writing anything.
 *
 * Usage:
 *   node scripts/backfill-celebrity-name.mjs --dry-run --brand=senvix
 *   node scripts/backfill-celebrity-name.mjs --brand=senvix
 *   node scripts/backfill-celebrity-name.mjs                  # all brands
 *   node scripts/backfill-celebrity-name.mjs --limit=5000     # cap
 *   node scripts/backfill-celebrity-name.mjs --batch-size=200
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY in .env.local. Falls back to
 * SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL for the project URL.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  buildCleanBrandPrefixes,
  extractCelebrity,
} from '../lib/offer-extract.mjs';

// ─── .env.local loader (no dotenv dep) ───
function loadDotEnv() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const envPath = path.resolve(here, '..', '.env.local');
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const k = trimmed.slice(0, eq).trim();
    let v = trimmed.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (!(k in process.env)) process.env[k] = v;
  }
}
loadDotEnv();

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!SUPABASE_URL) {
  console.error('FATAL: SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL is missing from environment.');
  process.exit(1);
}
if (!SERVICE_KEY) {
  console.error('FATAL: SUPABASE_SERVICE_ROLE_KEY is missing from environment.');
  console.error('       Add it to .env.local (same key Vercel uses for SUPABASE_SERVICE_ROLE_KEY).');
  console.error('       Anon key cannot UPDATE creatives without an RLS policy change.');
  process.exit(1);
}

// ─── CLI flags ───
function parseArgs(argv) {
  const opts = {
    dryRun: false,
    brand: null,
    limit: Infinity,
    batchSize: 500,
    concurrency: 30,
  };
  for (const a of argv) {
    if (a === '--dry-run') opts.dryRun = true;
    else if (a.startsWith('--brand=')) opts.brand = a.slice('--brand='.length).trim();
    else if (a.startsWith('--limit=')) opts.limit = parseInt(a.slice('--limit='.length), 10);
    else if (a.startsWith('--batch-size=')) opts.batchSize = parseInt(a.slice('--batch-size='.length), 10);
    else if (a.startsWith('--concurrency=')) opts.concurrency = parseInt(a.slice('--concurrency='.length), 10);
  }
  if (!Number.isFinite(opts.batchSize) || opts.batchSize <= 0) opts.batchSize = 500;
  if (!Number.isFinite(opts.concurrency) || opts.concurrency <= 0) opts.concurrency = 30;
  return opts;
}

// ─── Supabase fetch helpers ───
async function supaFetch(pathAndQuery, init = {}) {
  const res = await fetch(SUPABASE_URL + '/rest/v1' + pathAndQuery, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`supaFetch ${res.status} ${pathAndQuery}: ${text.slice(0, 200)}`);
  }
  if (res.status === 204) return null;
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('json')) return null;
  return res.json();
}

async function loadBrandPrefixes() {
  const all = [];
  const PAGE = 1000;
  let offset = 0;
  while (true) {
    const page = await supaFetch(
      `/scam_brands?select=normalized_name&limit=${PAGE}&offset=${offset}&order=normalized_name.asc`,
      { method: 'GET' }
    );
    if (!Array.isArray(page) || page.length === 0) break;
    for (const r of page) {
      if (r && r.normalized_name) all.push(r.normalized_name);
    }
    if (page.length < PAGE) break;
    offset += page.length;
  }
  return buildCleanBrandPrefixes(all);
}

// ─── Page through empty-celebrity rows by id keyset ───
//
// Keyset pagination (id > lastId) instead of limit+offset because:
//   1. The predicate `celebrity_name = ''` keeps matching for any row we
//      don't update (extraction returned ''), so offset semantics would
//      either infinite-loop or skip rows depending on order stability.
//   2. UUIDs sort lexically and are stable, so keyset is fine.
async function fetchPage({ afterId, brandPrefix, batchSize }) {
  const params = new URLSearchParams();
  params.set('select', 'id,normalized_offer,celebrity_name');
  // celebrity_name empty OR NULL
  params.set('or', '(celebrity_name.eq.,celebrity_name.is.null)');
  params.set('order', 'id.asc');
  params.set('limit', String(batchSize));
  if (afterId) params.append('id', `gt.${afterId}`);
  if (brandPrefix) params.append('normalized_offer', `ilike.${brandPrefix}%`);
  const rows = await supaFetch(`/creatives?${params.toString()}`, { method: 'GET' });
  return Array.isArray(rows) ? rows : [];
}

async function updateCelebrity(id, celebrity) {
  await supaFetch(`/creatives?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ celebrity_name: celebrity }),
  });
}

// Run UPDATEs with bounded concurrency.
async function runWithConcurrency(items, concurrency, worker) {
  let idx = 0;
  let okCount = 0;
  let failCount = 0;
  const failures = [];
  async function pump() {
    while (idx < items.length) {
      const my = idx++;
      try {
        await worker(items[my]);
        okCount++;
      } catch (e) {
        failCount++;
        if (failures.length < 10) failures.push({ item: items[my], err: e.message });
      }
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => pump());
  await Promise.all(workers);
  return { okCount, failCount, failures };
}

// ─── Main ───
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  console.log('[backfill-celeb]', JSON.stringify({
    dryRun: opts.dryRun,
    brand: opts.brand,
    limit: Number.isFinite(opts.limit) ? opts.limit : 'none',
    batchSize: opts.batchSize,
    concurrency: opts.concurrency,
  }));

  console.log('[backfill-celeb] Loading brand prefixes from scam_brands...');
  const brandPrefixes = await loadBrandPrefixes();
  console.log(`[backfill-celeb] ${brandPrefixes.length} clean prefixes (longest first: ${
    brandPrefixes.slice(0, 3).map(p => JSON.stringify(p)).join(', ')
  } ...)`);

  const startedAt = Date.now();
  let afterId = '';
  let processed = 0;
  let updated = 0;
  let empty = 0;
  let totalErrors = 0;
  let firstBatchSample = null;

  while (true) {
    const remaining = opts.limit - processed;
    if (remaining <= 0) break;
    const pageSize = Math.min(opts.batchSize, remaining);

    const rows = await fetchPage({
      afterId,
      brandPrefix: opts.brand,
      batchSize: pageSize,
    });
    if (rows.length === 0) break;

    // Decide per row.
    const updates = [];
    const beforeAfter = [];
    for (const row of rows) {
      const newCeleb = extractCelebrity(row.normalized_offer, brandPrefixes);
      beforeAfter.push({
        id: row.id,
        offer: row.normalized_offer,
        before: row.celebrity_name === null ? '<NULL>' : row.celebrity_name,
        after: newCeleb,
      });
      if (newCeleb) {
        updates.push({ id: row.id, celebrity: newCeleb });
      } else {
        empty++;
      }
    }

    // First-batch sample for dry-run output.
    if (firstBatchSample === null) firstBatchSample = beforeAfter;

    if (opts.dryRun) {
      console.log('');
      console.log('[backfill-celeb] --dry-run: sample of first batch (up to 20 rows):');
      const sample = beforeAfter.slice(0, 20);
      for (const s of sample) {
        const arrow = s.after ? ' →' : ' ⊘';
        console.log(`  offer=${JSON.stringify(s.offer)}`);
        console.log(`    before=${JSON.stringify(s.before)}${arrow} after=${JSON.stringify(s.after)}`);
      }
      console.log('');
      console.log(`[backfill-celeb] dry-run: first batch had ${rows.length} rows; ${updates.length} would update, ${empty} would stay empty.`);

      // Best-effort estimate of total scope.
      try {
        const countParams = new URLSearchParams();
        countParams.set('select', 'id');
        countParams.set('or', '(celebrity_name.eq.,celebrity_name.is.null)');
        if (opts.brand) countParams.append('normalized_offer', `ilike.${opts.brand}%`);
        countParams.set('limit', '1');
        const countRes = await fetch(SUPABASE_URL + '/rest/v1/creatives?' + countParams.toString(), {
          headers: {
            apikey: SERVICE_KEY,
            Authorization: `Bearer ${SERVICE_KEY}`,
            Prefer: 'count=exact',
            Range: '0-0',
          },
        });
        const cr = countRes.headers.get('content-range') || '';
        const total = cr.split('/')[1] || '?';
        console.log(`[backfill-celeb] dry-run: total in-scope rows in DB: ${total}${opts.brand ? ` (--brand=${opts.brand})` : ''}`);
      } catch (e) {
        console.log(`[backfill-celeb] dry-run: count estimate failed (${e.message})`);
      }
      console.log('[backfill-celeb] No writes made. Re-run without --dry-run to apply.');
      return;
    }

    // Apply updates with bounded concurrency.
    if (updates.length > 0) {
      const result = await runWithConcurrency(updates, opts.concurrency, (u) =>
        updateCelebrity(u.id, u.celebrity)
      );
      updated += result.okCount;
      totalErrors += result.failCount;
      if (result.failures.length > 0) {
        for (const f of result.failures.slice(0, 3)) {
          console.warn(`[backfill-celeb] WARN row ${f.item.id}: ${f.err.slice(0, 120)}`);
        }
      }
    }

    processed += rows.length;
    afterId = rows[rows.length - 1].id;

    const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
    console.log(`[backfill-celeb] processed=${processed} updated=${updated} empty=${empty} errors=${totalErrors} elapsed=${elapsedSec}s`);

    // If this page was smaller than requested AND we don't have a brand
    // filter, we've drained the table. Stop.
    if (rows.length < pageSize) break;
  }

  const totalElapsed = Math.round((Date.now() - startedAt) / 1000);
  console.log('');
  console.log('[backfill-celeb] === SUMMARY ===');
  console.log(`[backfill-celeb] total rows processed:    ${processed}`);
  console.log(`[backfill-celeb] rows updated (non-empty): ${updated}`);
  console.log(`[backfill-celeb] rows left empty:          ${empty}`);
  console.log(`[backfill-celeb] update errors:            ${totalErrors}`);
  console.log(`[backfill-celeb] elapsed:                  ${totalElapsed}s`);
}

main().catch((e) => {
  console.error('[backfill-celeb] FATAL', e);
  process.exit(1);
});
