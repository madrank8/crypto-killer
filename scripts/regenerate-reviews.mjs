/**
 * scripts/regenerate-reviews.mjs
 *
 * Bulk regeneration helper for Path B / schema-enrichment backfill.
 *
 * Reposts each target brand_id to /api/admin/reviews/generate so the writer
 * runs through the latest prompt (currently multi-agent-v1.2-enrichment) and
 * the resulting review picks up: claims[] (ClaimReview entities with Wayback
 * appearance URLs), item_list (typed product list), quotes[] (Quotation
 * entities), author_persona_id, item_reviewed (typed entity), and the full
 * Phase 2 schema enrichment.
 *
 * Without this, reviews generated before the v1.2 prompt landed (2026-04-25)
 * still render via Replit's synthesized fallbacks — valid schema, but missing
 * the writer-emitted enrichment that unlocks Google Fact Check Explorer
 * visibility and item_list rich results.
 *
 * Usage:
 *   ADMIN_SECRET=... node scripts/regenerate-reviews.mjs
 *   ADMIN_SECRET=... node scripts/regenerate-reviews.mjs primeaura quantum-ai
 *
 *   # Different host (preview / staging):
 *   ADMIN_SECRET=... ADMIN_BASE_URL=https://crypto-killer-git-... node scripts/regenerate-reviews.mjs
 *
 * Env:
 *   ADMIN_SECRET                  Required. The admin Bearer token (same one
 *                                 /api/admin routes accept; on Vercel this is
 *                                 whatever ADMIN_SECRET is).
 *   ADMIN_BASE_URL                Optional. Defaults to https://crypto-killer.vercel.app.
 *   NEXT_PUBLIC_SUPABASE_URL      Required unless present in .env.local.
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY Required unless present in .env.local.
 *
 * Defaults to the 5 reviews on the older 'multi-agent-v1.0-seo-v3.1-schema-v3-icp-v1'
 * prompt. Pass slugs as positional args to override.
 *
 * Throughput: sequential, ~3-6 minutes per review. The SSE stream is read end
 * to end before moving on, so a Ctrl+C aborts cleanly.
 *
 * Cost: each regen burns one Claude Opus call (~16k output tokens). At
 * Opus pricing that's ~$2-3 per review, ~$10-15 for the default set.
 */

import { readFileSync } from 'node:fs';

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

// Default targets: the 5 reviews on the pre-v1.2 prompt as of 2026-04-26.
// Override by passing slugs as positional args.
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
  // Look up brand_id for each slug via the reviews table (slug → brand_id)
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

  // Read SSE stream end-to-end. Each event: "data: <json>\n\n".
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

    // Process all complete events in the buffer
    let idx;
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const rawEvent = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const lines = rawEvent.split('\n');
      const dataLine = lines.find(l => l.startsWith('data: '));
      if (!dataLine) continue;
      let evt;
      try { evt = JSON.parse(dataLine.slice(6)); } catch { continue; }

      // Print progress only on step or major progress changes — keep noise down
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
  const argSlugs = process.argv.slice(2).filter(s => s && !s.startsWith('-'));
  const slugs = argSlugs.length > 0 ? argSlugs : DEFAULT_SLUGS;
  console.log(`[regen] base=${ADMIN_BASE_URL}`);
  console.log(`[regen] target slugs: ${slugs.join(', ')}`);

  const targets = await resolveBrandIds(slugs);
  if (targets.length === 0) {
    console.log('[regen] No targets resolved. Exiting.');
    return;
  }
  console.log(`[regen] resolved ${targets.length} brand_ids`);

  const results = [];
  for (let i = 0; i < targets.length; i++) {
    console.log(`\n=== ${i + 1}/${targets.length} ===`);
    try {
      results.push(await regenerateOne(targets[i]));
    } catch (e) {
      console.error(`  [crash] ${targets[i].slug}: ${e.message}`);
      results.push({ slug: targets[i].slug, ok: false, error: e.message });
    }
    // Brief pause between regens to be kind to API limits
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
