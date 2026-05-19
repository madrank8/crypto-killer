/**
 * scripts/rebrand-spyowl-to-cryptokiller.mjs
 *
 * One-shot rebrand pass: replaces user-visible "SpyOwl" references in
 * already-published review content with "CryptoKiller", and updates the
 * #spyowl-dataset JSON-LD @id fragment to #cryptokiller-dataset.
 *
 * Why this script exists:
 *   - We patched the prompts + sync-shape so FUTURE reviews are rebranded
 *     at generation time, but existing review rows already have "SpyOwl"
 *     baked into their prose and JSON-LD blobs.
 *   - Regenerating each review through the LLM pipeline would cost money
 *     and risk introducing unrelated changes. Targeted string replace
 *     leaves all other content exactly as it was.
 *
 * Safety:
 *   - --dry-run prints before/after diffs for each row and writes nothing.
 *   - Uses direct UPDATE on the reviews + review_translations rows. Does
 *     NOT touch updated_at / published_at / synced_at — those preserve.
 *   - Smart rewrites for awkward phrasings ("Crypto Killer operates SpyOwl,
 *     a proprietary X" → "Crypto Killer's X"). Default fallback: plain
 *     "SpyOwl" → "CryptoKiller".
 *
 * Usage:
 *   node scripts/rebrand-spyowl-to-cryptokiller.mjs --dry-run
 *   node scripts/rebrand-spyowl-to-cryptokiller.mjs --dry-run --slug=senvix
 *   node scripts/rebrand-spyowl-to-cryptokiller.mjs               # apply
 *   node scripts/rebrand-spyowl-to-cryptokiller.mjs --slug=senvix  # one
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY in .env.local.
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
const SVCK = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
if (!SBURL || !SVCK) {
  console.error('FATAL: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be in .env.local');
  process.exit(1);
}

function parseArgs(argv) {
  const o = { dryRun: false, slug: null };
  for (const a of argv) {
    if (a === '--dry-run') o.dryRun = true;
    else if (a.startsWith('--slug=')) o.slug = a.slice(7);
  }
  return o;
}
const opts = parseArgs(process.argv.slice(2));

// ─── Rebrand transformations ──────────────────────────────────────
//
// Order matters: smarter rewrites run first to catch redundant phrasings
// before the default replace would create awkward "Crypto Killer's
// CryptoKiller" constructions. Each rule is a [pattern, replacement] pair
// applied with String.prototype.replace (so $1, $2 etc. work for groups).
//
// We deliberately keep the rule set small and conservative — over-clever
// regex risks corrupting unrelated prose. After this pass any remaining
// "SpyOwl" tokens fall through to the default verbatim replace.

const SMART_REWRITES = [
  // "Crypto Killer operates|owns|maintains|runs SpyOwl, (a/an/our/the) X" → "Crypto Killer's X"
  // Require a comma after SpyOwl so we only match the apposition pattern
  // ("operates SpyOwl, a proprietary X") and never bridge sentences
  // ("operates SpyOwl. The data shows..." stays two sentences).
  [
    /(Crypto\s*Killer)\s+(?:operates|owns|maintains|runs|developed|built)\s+SpyOwl,\s+(?:a|an|the|our)\s+/gi,
    "$1's ",
  ],
  // "Crypto Killer's SpyOwl X" → "Crypto Killer's X" (avoid possessive double-up)
  [
    /(Crypto\s*Killer)'s\s+SpyOwl\b/g,
    "$1's CryptoKiller",
  ],
  // "powered by SpyOwl X technology" → "powered by our proprietary CryptoKiller X technology"
  // (already partially handled in source code, but defensively cover stored prose too)
  [
    /\bpowered by SpyOwl\b/g,
    "powered by our proprietary CryptoKiller",
  ],
];

const SCHEMA_FRAGMENT = [/#spyowl-dataset\b/g, "#cryptokiller-dataset"];

function rebrandString(s) {
  if (typeof s !== 'string' || !s) return s;
  let out = s;
  for (const [pat, repl] of SMART_REWRITES) out = out.replace(pat, repl);
  out = out.replace(SCHEMA_FRAGMENT[0], SCHEMA_FRAGMENT[1]);
  // Default verbatim replace for any remaining "SpyOwl" (capitalized).
  out = out.replace(/\bSpyOwl\b/g, 'CryptoKiller');
  // Lowercase "spyowl" only inside text (not URLs — but stored prose fields
  // shouldn't carry URLs containing spyowl in the first place; the scraper
  // URL is in env, not in published content).
  out = out.replace(/\bspyowl\b/g, 'cryptokiller');
  return out;
}

// Walk an arbitrary JSON value and apply rebrandString to every string.
function rebrandDeep(value) {
  if (typeof value === 'string') return rebrandString(value);
  if (Array.isArray(value)) return value.map(rebrandDeep);
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value)) out[k] = rebrandDeep(value[k]);
    return out;
  }
  return value;
}

// ─── Field whitelist ──────────────────────────────────────────────
//
// We rebrand only fields that hold user-visible prose or structured
// content shipped to Replit. Internal admin fields (generation_notes,
// polish_error, fact_check_status, ai_model, ai_prompt_version) are
// untouched so the audit trail stays honest.
const REVIEW_TEXT_FIELDS = [
  'title', 'headline', 'alternative_headline', 'summary', 'verdict',
  'meta_description', 'methodology', 'disclaimer', 'expertise_depth',
  'not_for_you', 'protection_steps', 'how_it_works', 'full_article',
  'hero_image_credit', 'hero_image_alt', 'author_credentials', 'author_bio',
  'information_gain_summary', 'target_keyword',
];
const REVIEW_JSON_FIELDS = [
  'red_flags', 'key_takeaways', 'faq', 'sources', 'dataset', 'schema_json',
  'visual_meta', 'content_images', 'experience_signals', 'trust_indicators',
  'claims', 'quotes', 'citations', 'item_reviewed', 'how_to', 'item_list',
  'update_history',
];

// Translations have the same shape but a smaller set of fields persisted.
const TRANSLATION_TEXT_FIELDS = [
  'title', 'meta_description', 'headline', 'alternative_headline',
  'summary', 'verdict', 'how_it_works', 'full_article',
  'not_for_you', 'protection_steps', 'methodology', 'disclaimer',
  'expertise_depth',
];
const TRANSLATION_JSON_FIELDS = [
  'red_flags', 'faq', 'key_takeaways',
];

// ─── Supabase helpers ────────────────────────────────────────────
async function sb(pathAndQuery, init = {}) {
  const res = await fetch(SBURL + '/rest/v1' + pathAndQuery, {
    ...init,
    headers: {
      apikey: SVCK,
      Authorization: `Bearer ${SVCK}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Supabase ${res.status} ${pathAndQuery}: ${text.slice(0, 200)}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

// ─── Counting + diffing utilities ────────────────────────────────
function countMatches(value) {
  if (value == null) return 0;
  if (typeof value === 'string') {
    const a = (value.match(/\bSpyOwl\b/g) || []).length;
    const b = (value.match(/\bspyowl\b/g) || []).length;
    const c = (value.match(/#spyowl-dataset\b/g) || []).length;
    return a + b + c;
  }
  if (Array.isArray(value)) return value.reduce((sum, v) => sum + countMatches(v), 0);
  if (typeof value === 'object') {
    return Object.values(value).reduce((sum, v) => sum + countMatches(v), 0);
  }
  return 0;
}

function deepDiffFields(orig, rebranded, fields) {
  const out = {};
  for (const f of fields) {
    const before = orig?.[f];
    const after = rebranded?.[f];
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      out[f] = { before, after };
    }
  }
  return out;
}

// ─── Build the patched row ───────────────────────────────────────
function rebrandReviewRow(row) {
  const patch = {};
  let changed = 0;
  for (const f of REVIEW_TEXT_FIELDS) {
    if (typeof row[f] === 'string' && countMatches(row[f]) > 0) {
      patch[f] = rebrandString(row[f]);
      changed += 1;
    }
  }
  for (const f of REVIEW_JSON_FIELDS) {
    const v = row[f];
    if (v != null && countMatches(v) > 0) {
      patch[f] = rebrandDeep(v);
      changed += 1;
    }
  }
  return { patch, changedFieldCount: changed };
}

function rebrandTranslationRow(row) {
  const patch = {};
  let changed = 0;
  for (const f of TRANSLATION_TEXT_FIELDS) {
    if (typeof row[f] === 'string' && countMatches(row[f]) > 0) {
      patch[f] = rebrandString(row[f]);
      changed += 1;
    }
  }
  for (const f of TRANSLATION_JSON_FIELDS) {
    const v = row[f];
    if (v != null && countMatches(v) > 0) {
      patch[f] = rebrandDeep(v);
      changed += 1;
    }
  }
  return { patch, changedFieldCount: changed };
}

// ─── Main ────────────────────────────────────────────────────────
async function main() {
  console.log('[rebrand]', JSON.stringify(opts));

  // Pull all reviews (any status, any locale, master + non-master).
  // We sweep broadly so drafts and older non-master rows get cleaned too;
  // they'd otherwise drift if ever republished.
  const params = new URLSearchParams();
  params.set('select', '*');
  if (opts.slug) params.set('slug', `eq.${opts.slug}`);
  params.set('order', 'created_at.asc');
  const reviews = await sb(`/reviews?${params.toString()}`);
  console.log(`[rebrand] scanned ${reviews.length} reviews`);

  let touched = 0;
  let totalReplacements = 0;

  for (const row of reviews) {
    const { patch, changedFieldCount } = rebrandReviewRow(row);
    if (changedFieldCount === 0) continue;

    const before = JSON.stringify(row);
    const after = JSON.stringify({ ...row, ...patch });
    const beforeCount = (before.match(/SpyOwl|spyowl|#spyowl-dataset/gi) || []).length;
    const afterCount = (after.match(/SpyOwl|spyowl|#spyowl-dataset/gi) || []).length;
    const removed = beforeCount - afterCount;
    totalReplacements += removed;
    touched += 1;

    console.log(`  ${row.slug.padEnd(28)} locale=${row.locale}  fields=${changedFieldCount}  references_removed=${removed}`);

    if (opts.dryRun) {
      // Show a sample of changed fields (first 2) to confirm shape
      const sample = deepDiffFields(row, { ...row, ...patch }, [...REVIEW_TEXT_FIELDS, ...REVIEW_JSON_FIELDS]);
      const keys = Object.keys(sample).slice(0, 2);
      for (const k of keys) {
        const b = JSON.stringify(sample[k].before).slice(0, 140);
        const a = JSON.stringify(sample[k].after).slice(0, 140);
        console.log(`      [${k}] BEFORE: ${b}`);
        console.log(`      [${k}] AFTER:  ${a}`);
      }
    } else {
      // Apply
      await sb(`/reviews?id=eq.${encodeURIComponent(row.id)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify(patch),
      });
    }
  }

  // ── review_translations ──────────────────────────────────────
  const tParams = new URLSearchParams();
  tParams.set('select', '*');
  if (opts.slug) {
    // Translations join to the master review by review_id; resolve slug first.
    const masterIds = reviews.filter((r) => r.is_master).map((r) => r.id);
    if (masterIds.length > 0) tParams.set('review_id', `in.(${masterIds.join(',')})`);
  }
  tParams.set('order', 'created_at.asc');
  const translations = await sb(`/review_translations?${tParams.toString()}`);
  console.log(`[rebrand] scanned ${translations.length} translations`);

  let tTouched = 0;
  let tReplacements = 0;
  for (const row of translations) {
    const { patch, changedFieldCount } = rebrandTranslationRow(row);
    if (changedFieldCount === 0) continue;

    const before = JSON.stringify(row);
    const after = JSON.stringify({ ...row, ...patch });
    const beforeCount = (before.match(/SpyOwl|spyowl|#spyowl-dataset/gi) || []).length;
    const afterCount = (after.match(/SpyOwl|spyowl|#spyowl-dataset/gi) || []).length;
    const removed = beforeCount - afterCount;
    tReplacements += removed;
    tTouched += 1;

    console.log(`  [tx] review_id=${row.review_id.slice(0,8)}... locale=${row.locale}  fields=${changedFieldCount}  references_removed=${removed}`);

    if (!opts.dryRun) {
      await sb(`/review_translations?id=eq.${encodeURIComponent(row.id)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify(patch),
      });
    }
  }

  console.log('');
  console.log('[rebrand] === SUMMARY ===');
  console.log(`[rebrand] reviews:      touched=${touched}/${reviews.length}      references_removed=${totalReplacements}`);
  console.log(`[rebrand] translations: touched=${tTouched}/${translations.length}  references_removed=${tReplacements}`);
  if (opts.dryRun) {
    console.log('[rebrand] DRY-RUN — no writes performed. Re-run without --dry-run to apply.');
  } else {
    console.log('[rebrand] Done. Next step: re-sync to Replit so the rebranded content propagates.');
    console.log('[rebrand]   node scripts/resync-all-reviews.mjs --base=https://crypto-killer.vercel.app');
  }
}

main().catch((e) => {
  console.error('[rebrand] FATAL', e);
  process.exit(1);
});
