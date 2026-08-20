'use strict'

// Sullivan Gate — content-brief-generator v1.6 Step 1.6 (semantic-content-engine
// SC-098). A brief may only be generated if the topic is NON-COMMODITY: the author
// declares one of five content types and supplies that path's forcing inputs.
//
// HONESTY RULE 6 (verbatim from the skill): "Never bypass the Sullivan Gate. Do not
// invent forcing inputs to 'make a brief pass.' … Forcing inputs come from the user,
// the team, the dataset, or the portfolio — never from inference."
//
// This module therefore ONLY validates. It never infers, defaults, or fills a
// forcing input. A missing input is reported, never manufactured. The skill calls
// this a HARD STOP; the dashboard turns that into a recoverable form by showing the
// caller exactly which inputs are missing (see `missing`) — blocked, but never a
// dead end.

const CONTENT_TYPES = Object.freeze([
  'case_study',
  'original_data_study',
  'firsthand_review',
  'contrarian_opinion',
  'infrastructure',
])

// When each type applies — surfaced in the UI so the author can choose honestly.
const CONTENT_TYPE_LABELS = Object.freeze({
  case_study: 'Case study — what we executed and what happened (hard before/after numbers)',
  original_data_study: 'Original data study — proprietary survey / internal DB / lab test / audit (n≥100)',
  firsthand_review: 'Firsthand review — lived experience or operator field knowledge (≥3 anecdotes)',
  contrarian_opinion: 'Contrarian opinion — thesis against consensus, backed by ≥2 portfolio cases',
  infrastructure: 'Infrastructure — TOF entity/glossary/FAQ hub anchoring the graph (Winum exemption)',
})

// Field specs per content type. `kind` drives validation:
//   text        — non-blank string
//   int_min     — integer ≥ min
//   date        — YYYY-MM-DD
//   enum        — one of `values`
//   list_min    — array of ≥ min non-blank strings
//   qid         — Wikidata Q-ID shape (Q followed by digits)
const FORCING_INPUT_SPECS = Object.freeze({
  case_study: [
    { field: 'concrete_metric', kind: 'text', label: 'Concrete metric (before/after with hard numbers)' },
    { field: 'what_we_did_differently', kind: 'text', label: 'What we did differently (the unique execution choice)' },
    { field: 'timeframe', kind: 'text', label: 'Timeframe (when this happened)' },
    { field: 'proprietary_source', kind: 'text', label: 'Proprietary source (whose data — team / agency / platform / client)' },
  ],
  original_data_study: [
    { field: 'dataset_source', kind: 'enum', values: ['survey', 'internal_db', 'scrape_with_consent', 'lab_test', 'audit'], label: 'Dataset source' },
    { field: 'n_size', kind: 'int_min', min: 100, label: 'Sample size (integer ≥100; ≥200 for citation gravity)' },
    { field: 'methodology', kind: 'text', label: 'Methodology (1 paragraph: collection, controls, exclusions)' },
    { field: 'novel_finding', kind: 'text', label: 'Novel finding (headline insight absent from public corpora)' },
    { field: 'collection_date', kind: 'date', label: 'Collection date (YYYY-MM-DD)' },
  ],
  firsthand_review: [
    { field: 'direct_anecdotes', kind: 'list_min', min: 3, label: 'Direct anecdotes (≥3 specific moments)' },
    { field: 'field_observation_count', kind: 'text', label: 'Field observation count (quantified, e.g. "400 callouts since 2019")' },
    { field: 'recurring_pattern', kind: 'text', label: 'Recurring pattern noticed in the field' },
    { field: 'credentials', kind: 'text', label: 'Credentials (license / role / years grounding the experience)' },
  ],
  contrarian_opinion: [
    { field: 'consensus_position', kind: 'text', label: 'Consensus position (what "everyone says")' },
    { field: 'counter_position', kind: 'text', label: 'Counter position (the contrarian thesis, one sentence)' },
    { field: 'evidence_from_portfolio', kind: 'list_min', min: 2, label: 'Evidence from portfolio (≥2 concrete cases)' },
    { field: 'where_consensus_fails', kind: 'text', label: 'Where consensus fails (the real-world condition)' },
  ],
  infrastructure: [
    { field: 'entity_id', kind: 'qid', label: 'Wikidata Q-ID (verified, e.g. Q12345)' },
    { field: 'sub_entities', kind: 'list_min', min: 3, label: 'Sub-entities (≥3 child concepts this page anchors)' },
    { field: 'internal_link_targets', kind: 'list_min', min: 3, label: 'Internal link targets (≥3 commercial pages this supports)' },
    { field: 'semantic_role', kind: 'enum', values: ['definition', 'glossary', 'faq_hub', 'entity_page'], label: 'Semantic role' },
  ],
})

const isBlank = (v) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '')

function cleanList(v) {
  if (!Array.isArray(v)) return null
  const out = v.filter((x) => typeof x === 'string' && x.trim() !== '').map((x) => x.trim())
  return out
}

// Validate one field. Returns null when valid, else a reason string.
function checkField(spec, value) {
  if (isBlank(value)) return 'missing'
  switch (spec.kind) {
    case 'text':
      return typeof value === 'string' && value.trim() !== '' ? null : 'must be text'
    case 'enum':
      return spec.values.includes(value) ? null : `must be one of: ${spec.values.join(' | ')}`
    case 'int_min': {
      const n = typeof value === 'number' ? value : Number(value)
      if (!Number.isInteger(n)) return 'must be an integer'
      return n >= spec.min ? null : `must be ≥ ${spec.min}`
    }
    case 'date':
      return /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? null : 'must be YYYY-MM-DD'
    case 'list_min': {
      const list = cleanList(value)
      if (list === null) return 'must be a list'
      return list.length >= spec.min ? null : `needs at least ${spec.min} entries (got ${list.length})`
    }
    case 'qid':
      return /^Q\d+$/.test(String(value).trim()) ? null : 'must be a Wikidata Q-ID (e.g. Q12345)'
    default:
      return 'unknown field kind'
  }
}

/**
 * Run the Sullivan Gate.
 *
 * @param input { content_type, forcing_inputs }
 * @returns {
 *   ok,               // true only when the type is valid AND every forcing input passes
 *   content_type,     // the declared type, or null
 *   missing: [{ field, label, reason }],
 *   errors: [string], // gate-level problems (no/invalid content_type)
 *   specs             // the field specs for the declared type (drives the UI form)
 * }
 */
function validateSullivanGate(input = {}) {
  const { content_type: contentType, forcing_inputs: forcingInputs } = input || {}

  if (isBlank(contentType)) {
    return {
      ok: false,
      content_type: null,
      missing: [],
      specs: [],
      errors: [
        'No content_type declared. Choose one of: ' + CONTENT_TYPES.join(' | ') +
        '. If none fit, the brief is commodity content and SC-098 rejects it.',
      ],
    }
  }

  if (!CONTENT_TYPES.includes(contentType)) {
    return {
      ok: false,
      content_type: null,
      missing: [],
      specs: [],
      errors: [`Invalid content_type "${contentType}". Must be one of: ${CONTENT_TYPES.join(' | ')}.`],
    }
  }

  const specs = FORCING_INPUT_SPECS[contentType]
  const supplied = forcingInputs && typeof forcingInputs === 'object' && !Array.isArray(forcingInputs)
    ? forcingInputs
    : {}

  const missing = []
  for (const spec of specs) {
    const reason = checkField(spec, supplied[spec.field])
    if (reason) missing.push({ field: spec.field, label: spec.label, reason })
  }

  return { ok: missing.length === 0, content_type: contentType, missing, specs, errors: [] }
}

// The skill's HARD STOP message, so the API and UI report it identically.
function sullivanStopMessage(result) {
  if (!result || result.ok) return null
  if (result.errors.length > 0) return result.errors[0]
  const fields = result.missing.map((m) => `${m.field} (${m.reason})`).join(', ')
  return `Brief fails SC-098 Sullivan Test. Required forcing inputs for content_type=${result.content_type}: ${fields}. Supply these inputs to continue.`
}

module.exports = {
  CONTENT_TYPES,
  CONTENT_TYPE_LABELS,
  FORCING_INPUT_SPECS,
  validateSullivanGate,
  sullivanStopMessage,
}
