'use strict'

// Pure text helpers used across the topical-map pipeline. Extracted verbatim
// from stages.js so they can be unit-tested and reused (e.g. by the
// cannibalization stage). Behavior is intentionally unchanged.

function slugify(text) {
  return (
    String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 180) || 'topic'
  )
}

function tokenize(s) {
  return new Set(
    String(s || '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2)
  )
}

function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  for (const t of a) if (b.has(t)) inter += 1
  return inter / (a.size + b.size - inter)
}

module.exports = { slugify, tokenize, jaccard }
