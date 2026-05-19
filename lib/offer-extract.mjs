/**
 * Pure offer-name helpers.
 *
 * No Supabase / network dependencies — safe to import from both the
 * Next.js scraper (lib/scraper.js, ESM compiled by Next) and standalone
 * Node backfill scripts (scripts/*.mjs, raw Node ESM). Single source of
 * truth so the scraper's per-row logic and any backfill stay in lockstep.
 */

// Brand entries that look like the celebrity-leak bug already polluted
// them. scam_brands.normalized_name is derived from creatives.normalized_offer,
// and when offerName glued the celeb on, the brand entry inherited it.
// We must drop these before using the list as a prefix dictionary — otherwise
// "longest match" picks the celeb-laden entry and the celeb gets stripped
// out instead of extracted.
//
// We also drop sentence-like entries (cookie-banner text, LLM annotations
// like "(the text refers to ...)") that aren't real brand names. These are
// rare in scam_brands but bubble to the top of the longest-first list and
// bloat the dictionary.
const BRAND_POLLUTION_PATTERNS = [
  /,/,                              // multi-celeb: 'Senvix Ana Botín, Mamen Mendizábal'
  /\bnone mentioned\b/i,            // 'Senvix None mentioned'
  /\bmentioned in the context\b/i,  // 'Senvix Elon Musk (mentioned in the context of …)'
  /:\s/,                            // sentence punctuation: 'Cookies: We use these…'
  /\(\s*(?:the|no|not|a |an )/i,    // LLM annotation: '(the text refers …)' / '(no celebrities…)'
];
const BRAND_MAX_LEN = 120;          // real brand names aren't sentences

function isPollutedBrand(name) {
  if (name.length > BRAND_MAX_LEN) return true;
  for (const p of BRAND_POLLUTION_PATTERNS) {
    if (p.test(name)) return true;
  }
  return false;
}

// Patterns the extracted celebrity itself must NOT match. Different from
// BRAND_POLLUTION_PATTERNS because legitimate celebrity extractions are
// comma-separated lists ('Andrej Babiš, Elon Musk'), so we can't blanket-
// reject commas in the output. We only reject obvious "no celebrity here"
// junk. When matched, the caller falls through to a shorter prefix or
// returns ''.
const OUTPUT_JUNK_PATTERNS = [
  /\bnone mentioned\b/i,            // also catches 'Ai None mentioned' (longer brand stripped wrong)
  /\bnot mentioned\b/i,
  /^not applicable\b/i,
  /^n\/a$/i,
  /\bmentioned in the context\b/i,
  /\bno celebrit/i,                 // 'no celebrities are mentioned'
  /\bthe text refers\b/i,
  /\bname not specified\b/i,        // 'platform (name not specified in the text) <celeb>'
];

function isOutputJunk(remainder) {
  for (const p of OUTPUT_JUNK_PATTERNS) {
    if (p.test(remainder)) return true;
  }
  return false;
}

// Brand-suffix words. When the clean brand-prefix dictionary lacks a
// compound entry (e.g. 'Bitcoin Synergy' isn't in scam_brands, only
// 'Bitcoin' is), stripping just 'Bitcoin' from 'Bitcoin Synergy <celebs>'
// leaves 'Synergy <celebs>' as the celebrity — wrong. We shave additional
// leading tokens off the remainder when they look like brand-suffix
// scaffolding rather than name tokens.
//
// Conservative list: only words that have effectively zero overlap with
// real human first/last names. Non-English variants included where the
// English original appears in our data ('plattform' DE, 'platforma' ES/PT).
const BRAND_SUFFIX_WORDS = new Set([
  'platform', 'plattform', 'platforma',
  'app', 'apps',
  'ai', 'gpt', 'tech', 'bot',
  'algorithm', 'algo',
  'trading', 'trade',
  'invest', 'investment', 'investments',
  'finance', 'financial', 'capital', 'crypto',
  'pro', 'plus', 'prime',
  'synergy', 'system', 'systems', 'network',
  'project', 'plan', 'plans', 'program', 'programs',
  'method', 'service', 'services',
  'group', 'trust',
]);

// Shave leading brand-suffix tokens off the remainder. Returns the
// remainder unchanged when its first token is name-like.
function stripLeadingBrandWords(remainder) {
  let cur = remainder;
  while (cur) {
    // Split off the first whitespace-delimited token. Preserve punctuation
    // attached to it (e.g. 'Plus,' should NOT count as the suffix word
    // 'plus' — the comma indicates a name token).
    const m = cur.match(/^(\S+)(\s+|$)/);
    if (!m) break;
    const word = m[1];
    // Don't strip tokens that carry trailing punctuation — those mark a
    // boundary (likely a name): 'Pro,', 'Plus.', etc.
    if (/[^\p{L}\p{N}-]/u.test(word)) break;
    if (!BRAND_SUFFIX_WORDS.has(word.toLowerCase())) break;
    cur = cur.slice(word.length).replace(/^\s+/, '');
  }
  return cur;
}

function normalizeOffer(name) {
  if (!name) return 'unknown';
  return name.trim()
    .replace(/\s+/g, ' ')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/^(the|a|an)\s+/i, '')
    .trim();
}

/**
 * Build the in-memory prefix list used by extractCelebrity. Pass raw
 * scam_brands.normalized_name strings; returns deduped clean entries
 * sorted longest first. Matching is case-insensitive — original casing
 * is preserved for logging only.
 */
function buildCleanBrandPrefixes(rawBrandNames) {
  const seen = new Set();
  const clean = [];
  for (const raw of rawBrandNames || []) {
    if (!raw || typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (isPollutedBrand(trimmed)) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    clean.push(trimmed);
  }
  clean.sort((a, b) => b.length - a.length);
  return clean;
}

/**
 * Returns the trailing portion of offerName after stripping the longest
 * matching brand prefix from cleanBrandPrefixes. Returns '' when no
 * useful match exists.
 *
 * Match rules:
 *   - Case-insensitive at the start of the normalized offer.
 *   - Token boundary required: the character after the matched prefix
 *     must be whitespace OR end-of-string. This prevents 'Senvix' from
 *     matching 'SenvixTrust', and prevents 'Senvix' from matching
 *     'Senvix-Plattform' (a hyphen is not whitespace, so the longer
 *     'Senvix-Plattform' brand entry handles that case instead).
 *   - Fallthrough: if the longest match strips everything and leaves an
 *     empty remainder, continue to the next-shorter match. Necessary
 *     because polluted-but-not-comma brand entries like 'Senvix Robert
 *     Benton' DO survive the pollution filter, and we don't want them
 *     to swallow the celebrity they leaked.
 *
 * Unicode is preserved end-to-end — no ASCII folding, no case folding
 * beyond JS's default lowercase. Czech, Greek, Cyrillic, Japanese, etc.
 * all flow through unchanged.
 */
function extractCelebrity(offerName, cleanBrandPrefixes) {
  if (!offerName) return '';
  const norm = normalizeOffer(offerName);
  if (norm === 'unknown') return '';
  const normLower = norm.toLowerCase();

  for (const prefix of cleanBrandPrefixes || []) {
    const pLower = prefix.toLowerCase();
    if (!normLower.startsWith(pLower)) continue;
    const after = norm.charAt(prefix.length);
    if (after !== '' && !/\s/.test(after)) continue;
    const rawRemainder = norm.slice(prefix.length).trim();
    // Shave leading brand-suffix words: 'Bitcoin' matched but the actual
    // brand is 'Bitcoin Synergy' → remainder = 'Synergy Chrystia Freeland'
    // → shave 'Synergy' → 'Chrystia Freeland'. Catches the compound-brand
    // gap when scam_brands lacks the compound entry.
    const remainder = stripLeadingBrandWords(rawRemainder);
    if (remainder && !isOutputJunk(remainder)) return remainder;
    // Empty or junk remainder — fall through to a shorter prefix that may
    // yield a real celebrity. 'Senvix None mentioned' first matches the
    // 'Senvix None mentioned' brand entry (filtered: junk), then 'Senvix'
    // (remainder = 'None mentioned', rejected as output junk), then no
    // shorter match → returns ''.
  }
  return '';
}

export { normalizeOffer, buildCleanBrandPrefixes, extractCelebrity };
