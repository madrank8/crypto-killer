/**
 * scripts/archive-landing-pages.mjs
 *
 * Path B one-shot: drives Wayback captures for a set of brand slugs (or
 * all brands scoring >= 40) and persists the results in
 * brand_landing_pages via the upsert_brand_landing_page RPC.
 *
 * Mirrors the logic in app/api/cron/archive-landing-pages/route.js
 * (which runs on Vercel with service_role auth). This script uses the
 * anon key + the SECURITY DEFINER RPC so it can run from a local shell
 * without the Vercel deployment protection getting in the way.
 *
 * Usage:
 *   node scripts/archive-landing-pages.mjs                   # all brands scam_score>=40
 *   node scripts/archive-landing-pages.mjs <slug> [<slug>...] # specific slugs only
 *
 * Throughput: rate-limited 6s per Wayback Save call. For the 8 Phase-2
 * brands (24 URLs) expect ~2.5 minutes.
 */

import { saveToWayback, extractHostname } from '../lib/wayback.js';

const SUPABASE_URL = 'https://rqyfuioazbdixflqngcs.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJxeWZ1aW9hemJkaXhmbHFuZ2NzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ3NzgyNDAsImV4cCI6MjA5MDM1NDI0MH0.QGi5QSr7x8zIKJrHo4vohT7eaMA7DRMqKYgprM5Ftoo';
const SCORE_THRESHOLD = 40;
const MAX_URLS_PER_BRAND = 3;
const STALE_DAYS = 30;
const MAX_ATTEMPTS = 5;

async function supaFetch(path, opts = {}) {
  const r = await fetch(SUPABASE_URL + '/rest/v1' + path, {
    ...opts,
    headers: {
      apikey: SUPABASE_ANON,
      Authorization: 'Bearer ' + SUPABASE_ANON,
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      ...(opts.headers || {}),
    },
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`supaFetch ${r.status}: ${path} :: ${text.slice(0, 200)}`);
  }
  return r.json();
}

async function upsertLandingPage(args) {
  return supaFetch('/rpc/upsert_brand_landing_page', {
    method: 'POST',
    body: JSON.stringify({
      p_brand_id: args.brandId,
      p_live_url: args.liveUrl,
      p_live_hostname: args.liveHostname,
      p_archive_url: args.archiveUrl,
      p_archive_status: args.archiveStatus,
      p_http_status: args.httpStatus,
      p_last_error: args.lastError,
    }),
  });
}

async function main() {
  const argSlugs = process.argv.slice(2);
  let filter;
  if (argSlugs.length > 0) {
    // Build PostgREST in-filter e.g. slug=in.(a,b,c)
    filter = `slug=in.(${argSlugs.map(encodeURIComponent).join(',')})`;
    console.log(`[archive] Targeting ${argSlugs.length} specific slug(s): ${argSlugs.join(', ')}`);
  } else {
    filter = `scam_score=gte.${SCORE_THRESHOLD}&landing_urls=not.eq.{}`;
    console.log(`[archive] Targeting all brands with scam_score >= ${SCORE_THRESHOLD} and non-empty landing_urls`);
  }

  const brands = await supaFetch(
    `/scam_brands?${filter}&order=scam_score.desc&select=id,slug,scam_score,landing_urls`
  );
  if (!Array.isArray(brands) || brands.length === 0) {
    console.log('[archive] No candidate brands.');
    return;
  }
  console.log(`[archive] ${brands.length} brand(s) selected.`);

  // Existing captures — pull all and index by URL + hostname so the
  // inner loop doesn't do per-URL Supabase round-trips.
  const existing = await supaFetch(
    `/brand_landing_pages?select=live_url,live_hostname,archive_status,captured_at,attempts`
  );
  const byUrl = new Map();
  const byHostRecent = new Map();
  const staleCutoffIso = new Date(Date.now() - STALE_DAYS * 86_400_000).toISOString();
  for (const row of existing) {
    byUrl.set(row.live_url, row);
    if (row.archive_status === 'success' && row.live_hostname && row.captured_at) {
      const prev = byHostRecent.get(row.live_hostname);
      if (!prev || row.captured_at > prev) byHostRecent.set(row.live_hostname, row.captured_at);
    }
  }

  const result = {
    scanned_brands: brands.length,
    candidate_urls: 0,
    skipped_existing: 0,
    skipped_hostname_dedup: 0,
    skipped_dead: 0,
    attempted: 0,
    succeeded: 0,
    failed: 0,
    rate_limited: 0,
    errors: [],
  };

  outer: for (const brand of brands) {
    const urls = Array.isArray(brand.landing_urls)
      ? brand.landing_urls.slice(0, MAX_URLS_PER_BRAND)
      : [];
    console.log(`\n[archive] ${brand.slug} (score=${brand.scam_score}) — top ${urls.length} URLs`);
    for (const url of urls) {
      result.candidate_urls++;
      const hostname = extractHostname(url);
      const existingRow = byUrl.get(url);

      if (existingRow) {
        if ((existingRow.attempts ?? 0) >= MAX_ATTEMPTS) {
          result.skipped_dead++;
          console.log(`  [dead-skip] ${url.slice(0, 80)}`);
          continue;
        }
        if (existingRow.captured_at && existingRow.captured_at > staleCutoffIso) {
          result.skipped_existing++;
          console.log(`  [fresh-skip] ${url.slice(0, 80)}`);
          continue;
        }
      }

      if (hostname) {
        const hostLast = byHostRecent.get(hostname);
        if (hostLast && hostLast > staleCutoffIso) {
          result.skipped_hostname_dedup++;
          console.log(`  [host-skip] ${hostname}`);
          continue;
        }
      }

      result.attempted++;
      console.log(`  [saving] ${url.slice(0, 100)}`);
      const capture = await saveToWayback(url);

      if (capture.status === 'success') result.succeeded++;
      else if (capture.status === 'rate_limited') result.rate_limited++;
      else result.failed++;

      try {
        await upsertLandingPage({
          brandId: brand.id,
          liveUrl: url,
          liveHostname: hostname,
          archiveUrl: capture.archiveUrl,
          archiveStatus: capture.status,
          httpStatus: capture.httpStatus,
          lastError: capture.error ? capture.error.slice(0, 500) : null,
        });
        console.log(`    -> ${capture.status}${capture.archiveUrl ? ` (${capture.archiveUrl.slice(0, 100)})` : ''}`);
      } catch (e) {
        result.errors.push({ url, error: e.message?.slice(0, 200) });
        console.log(`    -> PERSIST FAILED: ${e.message?.slice(0, 80)}`);
      }

      if (capture.status === 'success' && hostname) {
        byHostRecent.set(hostname, new Date().toISOString());
      }

      if (capture.status === 'rate_limited') {
        console.log('[archive] Wayback rate-limited us — aborting run early.');
        break outer;
      }
    }
  }

  console.log('\n[archive] SUMMARY:', JSON.stringify(result, null, 2));
}

main().catch(e => { console.error('[archive] FATAL', e); process.exit(1); });
