'use strict'

// Canonical per-brand stat definitions — the single source of truth shared by the
// integrity checker (which DETECTS a hard-coded literal) and the tokenizer (which
// FIXES it). Defining them once means the two can never disagree about what counts
// as a per-brand stat literal.
//
// Each stat is scraped from the ads-spy tool and kept current on the brand row, and
// has a {{stat:KEY}} token that Replit resolves against that live value at render.
// A number written as a literal in prose freezes at generation time and drifts.
//
// `detectRe` is used read-only (does the article claim a number for this stat?).
// `replaceRe` additionally captures the trailing noun so the tokenizer can swap the
// NUMBER for the token while preserving the noun and its spacing exactly:
//   "3,000+ ad creatives"  ->  "{{stat:ad_creatives}} ad creatives"
const BRAND_STATS = Object.freeze([
  {
    field: 'total_creatives', token: '{{stat:ad_creatives}}', label: 'ad creatives',
    detectRe: /([\d][\d,.]*)\s*\+?\s*(?:ad\s+)?creatives/gi,
    replaceRe: /([\d][\d,.]*)(\s*\+)?(\s*(?:ad\s+)?creatives)\b/gi,
  },
  {
    field: 'total_geos', token: '{{stat:countries_targeted}}', label: 'countries',
    detectRe: /([\d][\d,.]*)\s*\+?\s*(?:countries|geos|geographies|markets)/gi,
    replaceRe: /([\d][\d,.]*)(\s*\+)?(\s*(?:countries|geos|geographies|markets))\b/gi,
  },
  {
    field: 'total_celebrities', token: '{{stat:celebrities_abused}}', label: 'celebrities',
    detectRe: /([\d][\d,.]*)\s*\+?\s*(?:celebrities|celebrity\s+(?:impersonations?|abuses?))/gi,
    replaceRe: /([\d][\d,.]*)(\s*\+)?(\s*(?:celebrities|celebrity\s+(?:impersonations?|abuses?)))\b/gi,
  },
])

// PLATFORM-scale claims need {{platform_stat:KEY}}, not a per-brand token. These do
// not appear in review prose today (0/30), so the tokenizer does not touch them —
// they are here only so the integrity checker keeps flagging them if they ever do.
const PLATFORM_STAT_PATTERNS = Object.freeze([
  { label: 'scam brands', detectRe: /([\d][\d,.]*)\s*\+?\s*(?:documented\s+|catalogued\s+|investigated\s+)?scam\s+brands/gi },
  { label: 'brands tracked', detectRe: /([\d][\d,.]*)\s*\+?\s*brands\s+(?:tracked|catalogued|documented)/gi },
])

module.exports = { BRAND_STATS, PLATFORM_STAT_PATTERNS }
