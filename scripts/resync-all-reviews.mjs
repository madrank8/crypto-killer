/**
 * scripts/resync-all-reviews.mjs
 *
 * One-shot helper: triggers a sync of every published EN-master review to
 * Replit by POSTing to the deployed admin sync endpoint. Use after
 * deploying a sync-shape.js change (new field shipped, etc.) so existing
 * published reviews flow through the new transform without manual clicks
 * in the admin UI.
 *
 * Why this script (vs. local shapeReviewForSync + direct POST to Replit):
 *   - Reuses the deployed Vercel code path so we sync via the exact same
 *     logic the admin UI uses (translations, recent ads, landing URLs,
 *     drift detection, hash verification all included).
 *   - Doesn't need REPLIT_SITE_URL / SYNC_SECRET locally — those stay on
 *     Vercel; only ADMIN_SECRET is needed here.
 *
 * Usage:
 *   node scripts/resync-all-reviews.mjs --base=https://your-app.vercel.app
 *   node scripts/resync-all-reviews.mjs --base=... --dry-run
 *   node scripts/resync-all-reviews.mjs --base=... --slug=senvix     # one only
 *
 * Requires in .env.local:
 *   - NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL)
 *   - NEXT_PUBLIC_SUPABASE_ANON_KEY (read access to reviews list)
 *   - ADMIN_SECRET                 (Bearer token for the /admin endpoint)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

function loadDotEnv() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const envPath = path.resolve(here, '..', '.env.local');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (!(k in process.env)) process.env[k] = v;
  }
}
loadDotEnv();

const SBURL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SBKEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const ADMIN = process.env.ADMIN_SECRET || '';

function parseArgs(argv) {
  const o = { base: null, dryRun: false, slug: null, locale: 'en', delay: 1200 };
  for (const a of argv) {
    if (a === '--dry-run') o.dryRun = true;
    else if (a.startsWith('--base=')) o.base = a.slice(7).replace(/\/+$/, '');
    else if (a.startsWith('--slug=')) o.slug = a.slice(7);
    else if (a.startsWith('--locale=')) o.locale = a.slice(9);
    else if (a.startsWith('--delay=')) o.delay = parseInt(a.slice(8), 10);
  }
  return o;
}

const opts = parseArgs(process.argv.slice(2));

if (!opts.base) {
  console.error('FATAL: --base=<vercel-url> is required (e.g. --base=https://your-app.vercel.app)');
  process.exit(1);
}
if (!SBURL || !SBKEY) {
  console.error('FATAL: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be in .env.local');
  process.exit(1);
}
if (!ADMIN) {
  console.error('FATAL: ADMIN_SECRET must be in .env.local (the same value as the Vercel env)');
  console.error('       Grab it from Vercel → Project → Settings → Environment Variables');
  process.exit(1);
}

async function listPublished() {
  const params = new URLSearchParams();
  params.set('select', 'id,slug,locale,is_master,status,published_at');
  params.set('status', 'eq.published');
  params.set('locale', `eq.${opts.locale}`);
  params.set('is_master', 'eq.true');
  if (opts.slug) params.append('slug', `eq.${opts.slug}`);
  params.set('order', 'published_at.asc');
  const res = await fetch(`${SBURL}/rest/v1/reviews?${params.toString()}`, {
    headers: { apikey: SBKEY, Authorization: `Bearer ${SBKEY}` },
  });
  if (!res.ok) throw new Error(`list failed ${res.status}: ${await res.text()}`);
  return res.json();
}

async function syncOne(id) {
  const res = await fetch(`${opts.base}/api/admin/reviews/${id}/sync`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ADMIN}`,
      'Content-Type': 'application/json',
    },
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function main() {
  console.log('[resync]', JSON.stringify(opts));
  const reviews = await listPublished();
  console.log(`[resync] found ${reviews.length} published EN-master review(s) to sync`);
  if (opts.dryRun) {
    for (const r of reviews) console.log(`  - ${r.slug.padEnd(30)} id=${r.id}`);
    console.log('[resync] dry-run — no syncs performed');
    return;
  }

  let ok = 0;
  let fail = 0;
  for (let i = 0; i < reviews.length; i++) {
    const r = reviews[i];
    process.stdout.write(`[${i+1}/${reviews.length}] ${r.slug.padEnd(30)} ... `);
    try {
      const { status, body } = await syncOne(r.id);
      if (status === 200 && body.success) {
        const integrity = body.full_article_hash_matches ? 'hash✓' : 'hash✗';
        const lenMatch = body.full_article_length_matches ? 'len✓' : 'len✗';
        console.log(`OK (${integrity} ${lenMatch})`);
        ok++;
      } else {
        console.log(`FAIL status=${status} ${JSON.stringify(body).slice(0, 200)}`);
        fail++;
      }
    } catch (e) {
      console.log(`ERROR ${e.message.slice(0, 200)}`);
      fail++;
    }
    if (i < reviews.length - 1 && opts.delay > 0) {
      await new Promise((r) => setTimeout(r, opts.delay));
    }
  }

  console.log('');
  console.log(`[resync] === SUMMARY ===`);
  console.log(`[resync] total: ${reviews.length}  ok: ${ok}  fail: ${fail}`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error('[resync] FATAL', e);
  process.exit(1);
});
