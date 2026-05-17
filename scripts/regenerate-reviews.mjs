/**
 * scripts/regenerate-reviews.mjs
 *
 * Bulk regeneration helper for prompt-version backfills.
 *
 * Reposts each target brand_id to /api/admin/reviews/generate so the writer
 * runs through the latest prompt and the resulting review picks up: claims[]
 * (ClaimReview entities with Wayback appearance URLs), item_list (typed
 * product list), quotes[] (Quotation entities), author_persona_id,
 * item_reviewed (typed entity), full Phase 2 schema enrichment, and (since
 * `multi-agent-v1.3-stat-tokens`) the {{stat:KEY}} token system that keeps
 * body prose in sync with live review_stats.
 *
 * Without this, reviews generated before a prompt version landed still
 * render via Replit's synthesized fallbacks — valid schema, but missing
 * the writer-emitted enrichment.
 *
 * Usage:
 *   ADMIN_SECRET=... node scripts/regenerate-reviews.mjs
 *   ADMIN_SECRET=... node scripts/regenerate-reviews.mjs primeaura quantum-ai
 *
 *   # Different host (preview / staging):
 *   ADMIN_SECRET=... ADMIN_BASE_URL=https://crypto-killer-git-... node scripts/regenerate-reviews.mjs
 *
 *   # Bulk modes:
 *   ADMIN_SECRET=... node scripts/regenerate-reviews.mjs --all-published --dry-run
 *   ADMIN_SECRET=... node scripts/regenerate-reviews.mjs --all-published \
 *       --skip-version=multi-agent-v1.3-stat-tokens --limit=20 --confirm
 *   ADMIN_SECRET=... node scripts/regenerate-reviews.mjs --all-published \
 *       --skip-version=multi-agent-v1.3-stat-tokens --start-from=quantum-ai --confirm
 *
 * Env:
 *   ADMIN_SECRET                  Required. The admin Bearer token (same one
 *                                 /api/admin routes accept; on Vercel this is
 *                                 whatever ADMIN_SECRET is).
 *   ADMIN_BASE_URL                Optional. Defaults to https://crypto-killer.vercel.app.
 *   NEXT_PUBLIC_SUPABASE_URL      Required unless present in .env.local.
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY Required unless present in .env.local.
 *
 * Flags:
 *   --all-published              Enumerate every Supabase review with status='published'.
 *                                Cannot be combined with positional slug args.
 *   --skip-version=<version>     Skip reviews already on this ai_prompt_version.
 *                                Recommended for backfills so re-runs are idempotent.
 *   --limit=<N>                  Stop after N regens (applied AFTER skip-version filter).
 *   --start-from=<slug>          Skip targets alphabetically until <slug>, then start.
 *                                Pairs with --limit for resumable batches.
 *   --dry-run                    List the resolved targets and exit. No API calls.
 *   --confirm                    Required when more than CONFIRM_THRESHOLD_TARGETS
 *                                targets are queued OR estimated cost exceeds
 *                                CONFIRM_THRESHOLD_USD. Forces an explicit ack
 *                                of the production cost before regen starts.
 *
 * No-flag default: 5 reviews on the older 'multi-agent-v1.0-seo-v3.1-schema-v3-icp-v1'
 * prompt. Pass slugs as positional args to override.
 *
 * Throughput: sequential, ~3-6 minutes per review. The SSE stream is read end
 * to end before moving on, so a Ctrl+C aborts cleanly.
 *
 * Cost: each regen burns one Claude Opus call (~16k output tokens). At
 * Opus pricing that's ~$2-3 per review. The full ~1700-review backfill is
 * ~$4,000-$6,000 and ~85-170 hours of wall time — pace it in batches with
 * --limit and --start-from.
 */

import { readFileSync } from 'node:fs';

const SECONDS_PER_REGEN_ESTIMATE = 240; // 4 min average
const USD_PER_REGEN_ESTIMATE = 2.5;
const CONFIRM_THRESHOLD_TARGETS = 50;
const CONFIRM_THRESHOLD_USD = 100;

function loadLocalEnv() {
  try {
    const text = readFileSync('.env.local', 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
      const idx = trimmed.indexOf('=');
      const key = trimmed.slice(0, idx);
      if (process.env[key]) continue;
      process.env[key] = trimmed.slice(idx + 1).replace(/^['"]|['"]$/g, '');
    }
  } catch {
    // Optional convenience only; CI can pass env vars directly.
  }
}

loadLocalEnv();

const ADMIN_BASE_URL = process.env.ADMIN_BASE_URL || 'https://crypto-killer.vercel.app';
const ADMIN_SECRET = process.env.ADMIN_SECRET;

if (!ADMIN_SECRET) {
  console.error('ERROR: ADMIN_SECRET env var is required.');
  console.error('       Get it from Vercel project Settings → Environment Variables.');
  process.exit(1);
}

const DEFAULT_SLUGS = [
  'quantum-ai',
  'primeaura',
  'senvix',
  'trade-vector-ai',
  'affitto-casa-immobiliare',
];

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON) {
  console.error('ERROR: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are required.');
  console.error('       Pass them as env vars or keep them in .env.local.');
  process.exit(1);
}

function parseArgs(argv) {
  const flags = {
    allPublished: false,
    skipVersion: null,
    limit: null,
    startFrom: null,
    dryRun: false,
    confirm: false,
  };
  const positional = [];
  for (const a of argv) {
    if (!a) continue;
    if (a === '--all-published') flags.allPublished = true;
    else if (a === '--dry-run') flags.dryRun = true;
    else if (a === '--confirm') flags.confirm = true;
    else if (a.startsWith('--skip-version=')) flags.skipVersion = a.slice('--skip-version='.length).trim() || null;
    else if (a.startsWith('--limit=')) {
      const n = Number.parseInt(a.slice('--limit='.length), 10);
      if (!Number.isFinite(n) || n <= 0) {
        console.error(`ERROR: --limit must be a positive integer (got: ${a})`);
        process.exit(1);
      }
      flags.limit = n;
    }
    else if (a.startsWith('--start-from=')) flags.startFrom = a.slice('--start-from='.length).trim() || null;
    else if (a.startsWith('--')) {
      console.error(`ERROR: unknown flag: ${a}`);
      process.exit(1);
    }
    else positional.push(a);
  }
  if (flags.allPublished && positional.length > 0) {
    console.error('ERROR: --all-published cannot be combined with positional slug args.');
    process.exit(1);
  }
  return { flags, positional };
}

async function supaFetch(path) {
  const r = await fetch(SUPABASE_URL + '/rest/v1' + path, {
    headers: {
      apikey: SUPABASE_ANON,
      Authorization: 'Bearer ' + SUPABASE_ANON,
    },
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`supaFetch ${r.status}: ${path} :: ${text.slice(0, 200)}`);
  }
  return r.json();
}

async function resolveBrandIds(slugs) {
  const out = [];
  for (const slug of slugs) {
    const rows = await supaFetch(
      `/reviews?slug=eq.${encodeURIComponent(slug)}&select=id,brand_id,slug,title,ai_prompt_version&limit=1`,
    );
    if (!Array.isArray(rows) || rows.length === 0) {
      console.warn(`  [warn] no review found for slug=${slug}`);
      continue;
    }
    out.push(rows[0]);
  }
  return out;
}

// Paginated enumeration so we don't hit Supabase's default 1000-row response cap.
async function enumerateAllPublished() {
  const PAGE = 1000;
  const all = [];
  let offset = 0;
  while (true) {
    const rows = await supaFetch(
      `/reviews?status=eq.published&select=id,brand_id,slug,title,ai_prompt_version&order=slug.asc&limit=${PAGE}&offset=${offset}`,
    );
    if (!Array.isArray(rows) || rows.length === 0) break;
    all.push(...rows);
    if (rows.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

function applyFilters(targets, flags) {
  let out = targets;
  if (flags.skipVersion) {
    const before = out.length;
    out = out.filter(t => t.ai_prompt_version !== flags.skipVersion);
    console.log(`[filter] skip-version=${flags.skipVersion}: ${before} → ${out.length} (${before - out.length} skipped)`);
  }
  if (flags.startFrom) {
    const before = out.length;
    out = out.filter(t => t.slug >= flags.startFrom);
    console.log(`[filter] start-from=${flags.startFrom}: ${before} → ${out.length}`);
  }
  if (flags.limit && out.length > flags.limit) {
    console.log(`[filter] limit=${flags.limit}: ${out.length} → ${flags.limit}`);
    out = out.slice(0, flags.limit);
  }
  return out;
}

function formatDuration(seconds) {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}min`;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return `${h}h${m ? ` ${m}min` : ''}`;
}

function previewTargets(targets) {
  const max = 10;
  const head = targets.slice(0, max);
  for (const t of head) {
    console.log(`  - ${t.slug.padEnd(40)} on ${t.ai_prompt_version || '(null)'}`);
  }
  if (targets.length > max) {
    console.log(`  … and ${targets.length - max} more`);
  }
}

async function regenerateOne(target) {
  const t0 = Date.now();
  console.log(`\n[regen] ${target.slug} (brand=${target.brand_id.slice(0, 8)}…) — was on '${target.ai_prompt_version}'`);

  const r = await fetch(`${ADMIN_BASE_URL}/api/admin/reviews/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ADMIN_SECRET}`,
      'Accept': 'text/event-stream',
    },
    body: JSON.stringify({ brand_id: target.brand_id }),
  });

  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`HTTP ${r.status} from /api/admin/reviews/generate: ${text.slice(0, 200)}`);
  }

  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let lastStep = '';
  let lastProgress = -1;
  let finalEvent = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    let idx;
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const rawEvent = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const lines = rawEvent.split('\n');
      const dataLine = lines.find(l => l.startsWith('data: '));
      if (!dataLine) continue;
      let evt;
      try { evt = JSON.parse(dataLine.slice(6)); } catch { continue; }

      const step = evt.step || '';
      const prog = typeof evt.progress === 'number' ? evt.progress : null;
      if (step && (step !== lastStep || (prog !== null && prog - lastProgress >= 10))) {
        const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
        const progStr = prog !== null ? `${prog}%` : '—';
        console.log(`  [${elapsed}s] ${step.padEnd(14)} ${progStr.padEnd(5)} ${(evt.message || '').slice(0, 90)}`);
        lastStep = step;
        if (prog !== null) lastProgress = prog;
      }
      if (evt.error || step === 'error') {
        finalEvent = { ok: false, evt };
      }
      if (step === 'complete' || step === 'done') {
        finalEvent = { ok: true, evt };
      }
    }
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  if (finalEvent && finalEvent.ok) {
    console.log(`  [done] ${target.slug} regenerated in ${elapsed}s`);
    return { slug: target.slug, ok: true, seconds: parseFloat(elapsed) };
  } else if (finalEvent) {
    console.log(`  [fail] ${target.slug}: ${(finalEvent.evt.message || 'unknown error').slice(0, 150)}`);
    return { slug: target.slug, ok: false, seconds: parseFloat(elapsed), error: finalEvent.evt.message };
  } else {
    console.log(`  [fail] ${target.slug}: stream ended without final event after ${elapsed}s`);
    return { slug: target.slug, ok: false, seconds: parseFloat(elapsed), error: 'no final event' };
  }
}

async function main() {
  const { flags, positional } = parseArgs(process.argv.slice(2));

  console.log(`[regen] base=${ADMIN_BASE_URL}`);

  let targets;
  if (flags.allPublished) {
    console.log(`[regen] enumerating all published reviews from Supabase…`);
    targets = await enumerateAllPublished();
    console.log(`[regen] found ${targets.length} published reviews`);
  } else {
    const slugs = positional.length > 0 ? positional : DEFAULT_SLUGS;
    console.log(`[regen] target slugs: ${slugs.join(', ')}`);
    targets = await resolveBrandIds(slugs);
  }

  if (targets.length === 0) {
    console.log('[regen] No targets resolved. Exiting.');
    return;
  }

  targets = applyFilters(targets, flags);
  if (targets.length === 0) {
    console.log('[regen] All targets filtered out. Nothing to do.');
    return;
  }

  const estSeconds = targets.length * SECONDS_PER_REGEN_ESTIMATE;
  const estUsd = targets.length * USD_PER_REGEN_ESTIMATE;
  console.log(`[regen] queued ${targets.length} target(s)`);
  console.log(`[regen] estimate: ~${formatDuration(estSeconds)} wall time, ~$${estUsd.toFixed(2)} in Claude calls`);

  if (flags.dryRun) {
    console.log('[regen] --dry-run, listing targets:');
    previewTargets(targets);
    console.log('[regen] dry run complete, no API calls made.');
    return;
  }

  const needsConfirm = targets.length > CONFIRM_THRESHOLD_TARGETS || estUsd > CONFIRM_THRESHOLD_USD;
  if (needsConfirm && !flags.confirm) {
    console.error(`ERROR: ${targets.length} targets / ~$${estUsd.toFixed(2)} exceeds the safety threshold ` +
                  `(${CONFIRM_THRESHOLD_TARGETS} targets / $${CONFIRM_THRESHOLD_USD}). ` +
                  `Re-run with --confirm to proceed, or narrow with --limit / --start-from.`);
    console.error('Preview of queued targets:');
    previewTargets(targets);
    process.exit(1);
  }

  const results = [];
  for (let i = 0; i < targets.length; i++) {
    console.log(`\n=== ${i + 1}/${targets.length} ===`);
    try {
      results.push(await regenerateOne(targets[i]));
    } catch (e) {
      console.error(`  [crash] ${targets[i].slug}: ${e.message}`);
      results.push({ slug: targets[i].slug, ok: false, error: e.message });
    }
    if (i < targets.length - 1) {
      await new Promise(r => setTimeout(r, 5000));
    }
  }

  console.log('\n=== SUMMARY ===');
  const ok = results.filter(r => r.ok).length;
  const fail = results.length - ok;
  console.log(`Succeeded: ${ok}/${results.length}`);
  if (fail > 0) {
    console.log(`Failed:    ${fail}`);
    for (const r of results.filter(r => !r.ok)) {
      console.log(`  - ${r.slug}: ${r.error || 'unknown'}`);
    }
  }
  console.log(JSON.stringify(results, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });
