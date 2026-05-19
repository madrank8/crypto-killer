/**
 * scripts/backfill-creative-urls.mjs
 *
 * Path B one-shot backfill: re-fetches every creative from SpyOwl and
 * pushes link_url / post_url / fp_link / link_text / main_text into the
 * creatives table via upsert_creatives RPC. Mirrors the production
 * scraper's upsert path exactly, minus the sync_runs bookkeeping, so it
 * can run from a local shell without needing the Vercel deploy.
 *
 * Finishes by triggering rebuild_brands to aggregate landing_urls onto
 * scam_brands — the single action the downstream sync/archive pipeline
 * actually depends on.
 *
 * Usage:
 *   node scripts/backfill-creative-urls.mjs
 *
 * Throughput: ~500 creatives per SpyOwl page, one upsert call per page.
 * At 81k creatives and ~1.5s per round-trip, this takes ~3-5 minutes.
 */

import fs from 'fs';
import { normalizeOffer, buildCleanBrandPrefixes, extractCelebrity } from '../lib/offer-extract.mjs';

const SUPABASE_URL = 'https://rqyfuioazbdixflqngcs.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJxeWZ1aW9hemJkaXhmbHFuZ2NzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ3NzgyNDAsImV4cCI6MjA5MDM1NDI0MH0.QGi5QSr7x8zIKJrHo4vohT7eaMA7DRMqKYgprM5Ftoo';
const SPYOWL_API = 'https://api.spyowl.icu';
const BATCH_SIZE = 500;
const SPYOWL_TIMEOUT_MS = 20_000;

async function loadBrandPrefixes() {
  const all = [];
  const PAGE = 1000;
  let offset = 0;
  while (true) {
    const page = await supaFetch(`/scam_brands?select=normalized_name&limit=${PAGE}&offset=${offset}&order=normalized_name.asc`);
    if (!Array.isArray(page) || page.length === 0) break;
    for (const r of page) {
      if (r && r.normalized_name) all.push(r.normalized_name);
    }
    if (page.length < PAGE) break;
    offset += page.length;
  }
  return buildCleanBrandPrefixes(all);
}

async function supaFetch(path) {
  const r = await fetch(SUPABASE_URL + '/rest/v1' + path, {
    headers: { apikey: SUPABASE_ANON, Authorization: 'Bearer ' + SUPABASE_ANON },
  });
  if (!r.ok) throw new Error(`supaFetch ${r.status}: ${await r.text()}`);
  return r.json();
}

async function spyowlPage(cookie, skip, limit, maxRetries = 3) {
  const url = `${SPYOWL_API}/creative/all?skip=${skip}&limit=${limit}&pageType=all&creativeType=all`;
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const r = await fetch(url, {
        headers: { Cookie: cookie },
        signal: AbortSignal.timeout(SPYOWL_TIMEOUT_MS),
      });
      if (!r.ok) throw new Error(`SpyOwl ${r.status}: ${(await r.text()).slice(0, 200)}`);
      return r.json();
    } catch (e) {
      lastErr = e;
      const backoff = 2000 * (attempt + 1);
      console.log(`[backfill] spyowlPage skip=${skip} attempt ${attempt + 1} failed (${e.code || e.message?.slice(0, 80)}), retrying in ${backoff}ms`);
      await new Promise(r => setTimeout(r, backoff));
    }
  }
  throw lastErr;
}

async function upsertRpc(rows, maxRetries = 3) {
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const r = await fetch(SUPABASE_URL + '/rest/v1/rpc/upsert_creatives', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_ANON,
          Authorization: 'Bearer ' + SUPABASE_ANON,
        },
        body: JSON.stringify({ payload: rows }),
      });
      if (!r.ok) throw new Error(`upsert_creatives ${r.status}: ${(await r.text()).slice(0, 200)}`);
      return r.json();
    } catch (e) {
      lastErr = e;
      const backoff = 1500 * (attempt + 1);
      console.log(`[backfill] upsertRpc attempt ${attempt + 1} failed (${e.code || e.message?.slice(0, 80)}), retrying in ${backoff}ms`);
      await new Promise(r => setTimeout(r, backoff));
    }
  }
  throw lastErr;
}

async function rebuildBrandsRpc() {
  const r = await fetch(SUPABASE_URL + '/rest/v1/rpc/rebuild_brands', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON,
      Authorization: 'Bearer ' + SUPABASE_ANON,
    },
    body: '{}',
  });
  if (!r.ok) throw new Error(`rebuild_brands ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

async function main() {
  console.log('[backfill] Fetching SpyOwl cookie from settings...');
  const rows = await supaFetch('/settings?key=eq.spyowl_cookie&select=value');
  const token = rows?.[0]?.value?.trim();
  if (!token) throw new Error('No SpyOwl cookie in settings table');
  const cookie = token.includes('=') ? token : '__Secure-spyowl.session_token=' + token;

  console.log('[backfill] Validating cookie...');
  const me = await fetch(SPYOWL_API + '/user/me', { headers: { Cookie: cookie } });
  if (!me.ok) throw new Error(`SpyOwl cookie invalid: ${me.status}`);
  console.log('[backfill] Cookie OK.');

  // Load brand-prefix dictionary once for the whole run — used by
  // extractCelebrity to recover celebrity_name when SpyOwl returns it empty.
  console.log('[backfill] Loading brand-prefix dictionary from scam_brands...');
  const brandPrefixes = await loadBrandPrefixes();
  console.log(`[backfill] ${brandPrefixes.length} clean brand prefixes loaded.`);

  // Resume-from-skip via CLI arg so socket reconnects don't start over.
  let skip = Number.isFinite(parseInt(process.argv[2], 10)) ? parseInt(process.argv[2], 10) : 0;
  if (skip > 0) console.log(`[backfill] Resuming from skip=${skip}`);
  let totalFetched = 0;
  let totalInserted = 0;
  let totalUpdated = 0;
  let totalWithLinkUrl = 0;
  const startedAt = Date.now();
  let pageIdx = 0;

  while (true) {
    const t0 = Date.now();
    // Outer retry loop — wraps fetch + upsert so transient socket
    // errors during response-body read recover without aborting the
    // whole backfill. Exponential-ish backoff up to 6 tries.
    let page;
    let creatives;
    let outerAttempt = 0;
    while (true) {
      try {
        page = await spyowlPage(cookie, skip, BATCH_SIZE);
        creatives = page.creatives || [];
        break;
      } catch (e) {
        outerAttempt++;
        if (outerAttempt >= 6) throw e;
        const backoff = Math.min(30000, 3000 * outerAttempt);
        console.log(`[backfill] outer retry ${outerAttempt}/6 for skip=${skip} (${e.code || e.message?.slice(0, 80)}), backing off ${backoff}ms`);
        await new Promise(r => setTimeout(r, backoff));
      }
    }
    if (creatives.length === 0) break;

    const payload = creatives.map(c => ({
      id: c._id,
      offer_name: c.offerName || '',
      normalized_offer: normalizeOffer(c.offerName),
      celebrity_name: c.celebrityName || extractCelebrity(c.offerName, brandPrefixes) || '',
      geo: c.geo || '',
      geo_region_id: c.geoRegionId || '',
      is_video: !!c.isVideo,
      land_language: c.landLanguage || '',
      is_favorite: !!c.isFavorite,
      created_at: c.createdAt || new Date().toISOString(),
      first_seen_at: c.createdAt || new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
      synced_at: new Date().toISOString(),
      link_url:  c.linkUrl  || '',
      post_url:  c.postUrl  || '',
      fp_link:   c.fpLink   || '',
      link_text: c.linkText || '',
      main_text: c.mainText || '',
    }));

    const withLink = payload.filter(p => p.link_url).length;
    totalWithLinkUrl += withLink;

    const result = await upsertRpc(payload);
    totalInserted += result.inserted || 0;
    totalUpdated += result.updated || 0;
    totalFetched += creatives.length;

    pageIdx++;
    const elapsedMs = Date.now() - t0;
    const totalElapsedSec = Math.round((Date.now() - startedAt) / 1000);
    console.log(`[backfill] page ${pageIdx} skip=${skip} fetched=${creatives.length} link_url=${withLink}/${creatives.length} upserted ins=${result.inserted} upd=${result.updated} (${elapsedMs}ms, total ${totalElapsedSec}s, hasMore=${page.hasMore})`);

    if (!page.hasMore || creatives.length < BATCH_SIZE) break;
    skip += creatives.length;
  }

  console.log('');
  console.log(`[backfill] Creative ingest complete: ${totalFetched} fetched, ${totalInserted} inserted, ${totalUpdated} updated, ${totalWithLinkUrl} with link_url (${Math.round(totalWithLinkUrl/totalFetched*100)}%)`);
  console.log('[backfill] Calling rebuild_brands()...');

  const rebuilt = await rebuildBrandsRpc();
  console.log(`[backfill] rebuild_brands: ${JSON.stringify(rebuilt)}`);

  console.log(`[backfill] Total elapsed: ${Math.round((Date.now() - startedAt) / 1000)}s`);
}

main().catch(e => { console.error('[backfill] FATAL', e); process.exit(1); });
