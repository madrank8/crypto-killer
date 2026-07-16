'use strict'

// Provenance levels for any metric-bearing topic field. The topical-map skill's
// HONESTY RULES override all other instructions: a value that did not come from
// a tool call must never be presented as fact. We encode that as data so it is
// enforced structurally, not by prompt.
const PROVENANCE = Object.freeze({
  MEASURED: 'measured',     // a tool call (DataForSEO / Ahrefs / SERP) returned it
  ESTIMATED: 'estimated',   // a model/heuristic produced it, explicitly labeled
  UNRESOLVED: 'unresolved', // no grounded source; treat as unknown, never fact
})

const VALID = new Set([PROVENANCE.MEASURED, PROVENANCE.ESTIMATED, PROVENANCE.UNRESOLVED])

function normalize(level) {
  return VALID.has(level) ? level : PROVENANCE.UNRESOLVED
}

function provenanceOf(provenanceMap, field) {
  const m = provenanceMap && typeof provenanceMap === 'object' ? provenanceMap : {}
  return normalize(m[field])
}

function isGrounded(provenanceMap, field) {
  const p = provenanceOf(provenanceMap, field)
  return p === PROVENANCE.MEASURED || p === PROVENANCE.ESTIMATED
}

function ungroundedValues(topic, provenanceMap, fields) {
  const t = topic && typeof topic === 'object' ? topic : {}
  const out = []
  for (const f of fields) {
    const v = t[f]
    const hasValue = v !== null && v !== undefined && v !== ''
    if (hasValue && !isGrounded(provenanceMap, f)) out.push(f)
  }
  return out
}

function buildProvenance(entries) {
  const src = entries && typeof entries === 'object' ? entries : {}
  const out = {}
  for (const k of Object.keys(src)) out[k] = normalize(src[k])
  return out
}

module.exports = { PROVENANCE, normalize, provenanceOf, isGrounded, ungroundedValues, buildProvenance }
