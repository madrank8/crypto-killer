/**
 * scripts/verify-claim-appearance.mjs
 *
 * Path B regression probe — shows what claims[].appearance would resolve
 * to for a given brand slug if you ran the publish flow right now. Useful
 * after migrations 005/006 land, after the scraper refreshes, and after
 * the archive cron catches up — you can verify end-to-end that archive
 * URLs actually reach Replit without clicking Publish.
 *
 * Usage (PowerShell or bash):
 *   node scripts/verify-claim-appearance.mjs <brand-slug>
 *
 * Example:
 *   node scripts/verify-claim-appearance.mjs floventra
 *
 * Reads .env.local for SUPABASE credentials; falls back to the hardcoded
 * anon key + public URL (read-only access is fine for this probe).
 *
 * Prints:
 *   1. Brand summary (score, landing_urls count from scam_brands)
 *   2. brand_landing_pages rows (success + attempts + staleness)
 *   3. Resolved URL priority list (archive-first, then live fallback)
 *   4. The review's claims[] array with each appearance slot filled in
 *      using the same 3-tier priority that shapeReviewForSync applies
 *
 * Exits 0 on clean run, 1 when the brand or review can't be found.
 * NEVER mutates anything.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
  || 'https://rqyfuioazbdixflqngcs.supabase.co';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJxeWZ1aW9hemJkaXhmbHFuZ2NzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ3NzgyNDAsImV4cCI6MjA5MDM1NDI0MH0.QGi5QSr7x8zIKJrHo4vohT7eaMA7DRMqKYgprM5Ftoo';

async function supaFetch(path) {
  const res = await fetch(SUPABASE_URL + '/rest/v1' + path, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`supaFetch ${res.status}: ${path} :: ${body.slice(0, 200)}`);
  }
  return res.json();
}

// Local mirror of lib/sync-shape.js :: normalizeBrandLandingUrls.
// Kept inline so this script stays standalone (no @/ alias resolution,
// no need to run through Next's bundler). Must stay in lock-step with
// the exported helper. If you change one, change the other.
function normalizeBrandLandingUrls(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const byCaptured = (a, b) => {
    const av = a.captured_at || '';
    const bv = b.captured_at || '';
    if (av === bv) return 0;
    return av < bv ? 1 : -1;
  };
  const successes = rows
    .filter((r) => r && r.archive_status === 'success' && typeof r.archive_url === 'string' && r.archive_url.startsWith('http'))
    .sort(byCaptured)
    .map((r) => r.archive_url);
  const liveFallbacks = rows
    .filter((r) => r && typeof r.live_url === 'string' && r.live_url.startsWith('http'))
    .sort(byCaptured)
    .map((r) => r.live_url);
  const seen = new Set();
  const out = [];
  for (const u of [...successes, ...liveFallbacks]) {
    if (seen.has(u)) continue;
    seen.add(u);
    out.push(u);
  }
  return out;
}

// Resolve an effective appearance URL for a single claim using the exact
// 3-tier fallback that sync-shape applies: writer-supplied → brand
// archives → brand.landing_urls live fallback. Matches the code path in
// lib/sync-shape.js for the options.landingUrls / review.ad_creative_urls
// / brand.landing_urls waterfall.
function resolveAppearance(claim, archiveUrls, brandLandingUrls) {
  if (typeof claim?.appearance === 'string' && claim.appearance.startsWith('http')) {
    return { source: 'writer', url: claim.appearance };
  }
  if (archiveUrls.length > 0) {
    return { source: 'brand_landing_pages', url: archiveUrls[0] };
  }
  if (Array.isArray(brandLandingUrls) && brandLandingUrls.length > 0) {
    const live = brandLandingUrls.find((u) => typeof u === 'string' && u.startsWith('http'));
    if (live) return { source: 'brand.landing_urls', url: live };
  }
  return { source: 'null (claim will be dropped at render)', url: null };
}

function truncate(s, max = 80) {
  if (typeof s !== 'string') return String(s);
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}

async function main() {
  const slug = process.argv[2];
  if (!slug) {
    console.error('Usage: node scripts/verify-claim-appearance.mjs <brand-slug>');
    process.exit(1);
  }

  // 1. Brand. Try the migration-005 select first; fall back to the
  // pre-migration select when scam_brands.landing_urls hasn't been
  // added yet so the rest of the probe still works during rollout.
  let brand;
  let migration005Applied = true;
  try {
    const brands = await supaFetch(`/scam_brands?slug=eq.${encodeURIComponent(slug)}&select=id,slug,name,scam_score,landing_urls&limit=1`);
    brand = brands?.[0];
  } catch (e) {
    if (e.message.includes('landing_urls does not exist')) {
      migration005Applied = false;
      const brands = await supaFetch(`/scam_brands?slug=eq.${encodeURIComponent(slug)}&select=id,slug,name,scam_score&limit=1`);
      brand = brands?.[0];
      if (brand) brand.landing_urls = [];
    } else {
      throw e;
    }
  }
  if (!brand) {
    console.error(`Brand not found for slug: ${slug}`);
    process.exit(1);
  }

  if (!migration005Applied) {
    console.log('!!! scam_brands.landing_urls column missing — migration 005 not applied yet.');
    console.log('    Fallback path (brand.landing_urls → []) below won\'t yield any URLs.\n');
  }

  console.log(`=== Brand ${brand.slug} ===`);
  console.log(`  id: ${brand.id}`);
  console.log(`  name: ${brand.name}`);
  console.log(`  scam_score: ${brand.scam_score}`);
  console.log(`  landing_urls (scam_brands): ${Array.isArray(brand.landing_urls) ? brand.landing_urls.length : 0} entries`);
  if (Array.isArray(brand.landing_urls)) {
    brand.landing_urls.slice(0, 5).forEach((u, i) => console.log(`    ${i + 1}. ${truncate(u, 110)}`));
    if (brand.landing_urls.length > 5) console.log(`    ... +${brand.landing_urls.length - 5} more`);
  }

  // 2. brand_landing_pages (archive state). Missing table → migration
  // 006 not applied yet; just note and proceed.
  let archiveRows = [];
  let migration006Applied = true;
  try {
    archiveRows = await supaFetch(
      `/brand_landing_pages?brand_id=eq.${brand.id}` +
        `&select=live_url,archive_url,archive_status,captured_at,attempts,http_status` +
        `&order=captured_at.desc&limit=20`
    );
  } catch (e) {
    migration006Applied = false;
    console.log(`\n=== brand_landing_pages ===`);
    console.log(`  !!! table query failed (${e.message.slice(0, 80)}...)`);
    console.log(`      migration 006 may not be applied yet.`);
  }

  console.log(`\n=== brand_landing_pages (${archiveRows.length} rows) ===`);
  if (archiveRows.length === 0) {
    console.log('  (no rows — archive cron has not run yet for this brand)');
  } else {
    archiveRows.slice(0, 10).forEach((r, i) => {
      console.log(`  ${i + 1}. [${r.archive_status}] attempts=${r.attempts} http=${r.http_status || '-'}  captured=${r.captured_at}`);
      console.log(`     live:    ${truncate(r.live_url, 100)}`);
      console.log(`     archive: ${truncate(r.archive_url || '(none)', 100)}`);
    });
  }

  // 3. Resolved URL priority list
  const archiveUrls = normalizeBrandLandingUrls(archiveRows);
  console.log(`\n=== Resolved URL priority (archive-first, then live fallback) ===`);
  console.log(`  ${archiveUrls.length} archive/live URLs selectable at publish time`);
  archiveUrls.slice(0, 5).forEach((u, i) => console.log(`    ${i + 1}. ${truncate(u, 110)}`));

  // 4. Review + claims appearance resolution
  // Skip reviews.ad_creative_urls — legacy column reference that was
  // never actually created in migrations. sync-shape reads it but the
  // priority-waterfall already handles the missing-column case (returns
  // empty array). If that column ever lands, add it back here.
  const reviews = await supaFetch(
    `/reviews?brand_id=eq.${brand.id}` +
      `&select=id,slug,status,claims` +
      `&order=updated_at.desc&limit=1`
  );
  const review = reviews?.[0];
  console.log(`\n=== Review ===`);
  if (!review) {
    console.log('  (no review found for this brand — generate one first)');
    return;
  }
  console.log(`  id: ${review.id}`);
  console.log(`  slug: ${review.slug}`);
  console.log(`  status: ${review.status}`);

  const claims = Array.isArray(review.claims) ? review.claims : [];
  console.log(`  claims[]: ${claims.length} entries\n`);
  if (claims.length === 0) {
    console.log('  (no claims to resolve)');
    return;
  }

  // Merge brand.landing_urls (raw SpyOwl URLs) as the final fallback
  // just like sync-shape does.
  const brandLive = Array.isArray(brand.landing_urls) ? brand.landing_urls : [];

  claims.forEach((c, i) => {
    const resolved = resolveAppearance(c, archiveUrls, brandLive);
    console.log(`  [${i}] "${truncate(c.claimReviewed || c.claim || '(no claimReviewed)', 80)}"`);
    console.log(`       writer appearance:   ${typeof c.appearance === 'string' ? truncate(c.appearance, 80) : JSON.stringify(c.appearance)}`);
    console.log(`       resolved source:     ${resolved.source}`);
    console.log(`       resolved URL:        ${truncate(resolved.url || '(null — claim will be dropped)', 100)}`);
    console.log('');
  });

  // Summary
  const withUrl = claims.filter((c) => resolveAppearance(c, archiveUrls, brandLive).url !== null).length;
  console.log(`=== Summary ===`);
  console.log(`  ${withUrl}/${claims.length} claims would emit a ClaimReview node on the live page`);
  if (withUrl < claims.length) {
    console.log(`  ${claims.length - withUrl} claims would be silently dropped — trigger the archive cron or rerun rebuild_brands to populate landing URLs`);
  }
  if (archiveUrls.length === 0 && brandLive.length > 0) {
    console.log(`  NOTE: only live URLs available — shipping ${withUrl} live-URL appearances. Trigger /api/cron/archive-landing-pages to replace with Wayback snapshots.`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
