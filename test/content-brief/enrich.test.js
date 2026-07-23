const { test } = require('node:test'); const assert = require('node:assert/strict')
const { PLACEHOLDER, assembleBrief } = require('../../lib/content-brief/assemble')
const {
  ENRICHABLE, PROTECTED, stripUnverifiableIdentifiers, mergeEnrichment, buildEnrichmentPrompt,
} = require('../../lib/content-brief/enrich')

const TOPIC = {
  title: 'How Rug Pulls Work', slug: 'how-rug-pulls-work', url_path: '/crypto-scams/rug-pulls/',
  target_keyword: 'how rug pulls work', section: 'core', node_type: 'standard',
  priority_score: 75, search_intent: 'informational', content_format: 'Evergreen Article',
  schema_type: 'Article', paa_questions: ['What is a rug pull?'],
  serp_features: ['ai_overview'], serp_authority: { dr_median: 55 },
}
const assembled = () => assembleBrief({ topic: TOPIC, siteUrl: 'https://cryptokiller.org', created: '2026-07-19' })

// ── The core guarantee: protected fields are immutable ───────────────────────
test('a model cannot overwrite ANY protected field', () => {
  const base = assembled()
  const attack = {}
  for (const f of PROTECTED) attack[f] = 'MODEL OVERWROTE THIS'
  const { brief, rejected } = mergeEnrichment(base, attack)
  for (const f of PROTECTED) {
    assert.deepEqual(brief[f], base[f], `protected field ${f} was mutated`)
    assert.ok(rejected.some((r) => r.field === f), `${f} not reported as rejected`)
  }
})

test('a model cannot fabricate a Wikidata Q-ID over the UNRESOLVED placeholder', () => {
  const base = assembled()
  assert.equal(base.entity_wikidata, PLACEHOLDER.UNRESOLVED_QID)
  const { brief } = mergeEnrichment(base, { entity_wikidata: 'Q99999999', entity_schema_same_as: ['https://www.wikidata.org/wiki/Q99999999'] })
  assert.equal(brief.entity_wikidata, PLACEHOLDER.UNRESOLVED_QID)
  assert.deepEqual(brief.entity_schema_same_as, [PLACEHOLDER.UNRESOLVED_QID])
})

test('a model cannot invent competitor metrics over [NO DATA]', () => {
  const base = assembled()
  const { brief } = mergeEnrichment(base, {
    competitor_benchmarks: { word_count: '2,400 words', avg_dr: 'DR 71', serp_features: ['featured_snippet'] },
    competitor_pages_to_beat: ['https://competitor.com/rug-pulls'],
  })
  assert.equal(brief.competitor_benchmarks.word_count, PLACEHOLDER.NO_DATA)
  assert.deepEqual(brief.competitor_pages_to_beat, [PLACEHOLDER.NO_DATA])
})

test('unknown keys are rejected, not merged', () => {
  const { brief, rejected } = mergeEnrichment(assembled(), { totally_made_up_field: 'x' })
  assert.equal(brief.totally_made_up_field, undefined)
  assert.match(rejected.find((r) => r.field === 'totally_made_up_field').reason, /not an enrichable/)
})

// ── Identifier stripping ─────────────────────────────────────────────────────
test('stripUnverifiableIdentifiers removes PMIDs/DOIs/URLs and marks the claim', () => {
  for (const input of [
    'Chainalysis 2024 rug pull report PMID: 12345678',
    'FTC crypto fraud data doi:10.1234/abcd.5678',
    'SEC enforcement summary https://sec.gov/litigation/12345',
    'Report at www.chainalysis.com/reports/2024',
  ]) {
    const { value, stripped } = stripUnverifiableIdentifiers(input)
    assert.equal(stripped, true, input)
    assert.ok(value.includes(PLACEHOLDER.UNVERIFIED), value)
    assert.ok(!/PMID|doi:|https?:\/\/|www\./i.test(value), `identifier survived: ${value}`)
  }
})

test('identifier stripping resists the obvious bypasses', () => {
  const bypasses = [
    'researchPMID:12345678',                 // glued, defeats \\b
    'pmid:12345678',
    'See 10.1234/abcd.5678 for the data',    // bare DOI, no doi: prefix
    'hxxps://sec.gov/litigation/12345',      // defanged scheme
    'sec.gov/litigation/12345',              // bare domain WITH path
    'Entity is Q99999999 per Wikidata',      // fabricated Q-ID
    'Competitors average DR 71 here',        // invented Ahrefs metric
  ]
  for (const input of bypasses) {
    const { value, stripped } = stripUnverifiableIdentifiers(input)
    assert.equal(stripped, true, `NOT stripped: ${input}`)
    assert.ok(value.includes(PLACEHOLDER.UNVERIFIED), value)
  }
})

test('a bare hostname with no path is KEPT (Section 9 wants authoritative domains)', () => {
  const { value, stripped } = stripUnverifiableIdentifiers('Cite sec.gov for enforcement actions')
  assert.equal(stripped, false)
  assert.equal(value, 'Cite sec.gov for enforcement actions')
})

test('EVERY enrichable field is deep-scrubbed, not just claim_categories', () => {
  const base = assembled()
  const { brief } = mergeEnrichment(base, {
    key_entities: [{ entity: 'SEC', attribute: 'wikidata', value: 'Q99999999' }],
    predicates: ['Documented under PMID:87654321'],
    visual_assets: [{ description: 'Competitor DR 71 chart', alt_text: 'see ahrefs.com/reports/x' }],
    bluf_target: 'Per 10.1234/abcd.5678, rug pulls drain liquidity.',
    key_claim_passages: ['Claim sourced from https://fake.example/study'],
  })
  const blob = JSON.stringify(brief)
  for (const leak of ['Q99999999', '87654321', 'DR 71', 'ahrefs.com/reports', '10.1234/abcd', 'https://fake.example']) {
    assert.ok(!blob.includes(leak), `leaked through: ${leak}`)
  }
})

test('outbound_link_targets keeps the domain but drops an unverifiable deep path', () => {
  const { brief, rejected } = mergeEnrichment(assembled(), {
    outbound_link_targets: ['sec.gov/litigation/99999 — enforcement precedent', 'pubmed.ncbi.nlm.nih.gov'],
  })
  assert.equal(brief.outbound_link_targets[0], 'sec.gov — enforcement precedent')
  assert.equal(brief.outbound_link_targets[1], 'pubmed.ncbi.nlm.nih.gov')
  assert.ok(rejected.some((r) => r.reason.includes('deep path removed')))
})

test('experience_angle from the Sullivan gate cannot be overwritten by the model', () => {
  const withGate = assembleBrief({
    topic: TOPIC, created: '2026-07-19',
    sullivan: { content_type: 'firsthand_review', forcing_inputs: { recurring_pattern: 'Liquidity pulled within 72h' } },
  })
  const { brief, rejected } = mergeEnrichment(withGate, { experience_angle: 'Fabricated first-hand story' })
  assert.equal(brief.experience_angle, 'Liquidity pulled within 72h')
  assert.match(rejected.find((r) => r.field === 'experience_angle').reason, /human-supplied/)
})

test('experience_angle IS writable while it is still the placeholder', () => {
  const { brief } = mergeEnrichment(assembled(), { experience_angle: 'Investigator notes from 400 callouts' })
  assert.equal(brief.experience_angle, 'Investigator notes from 400 callouts')
})

test('enriched reports only fields that ACTUALLY changed', () => {
  const base = assembled()
  // competitor_benchmarks inside claim_categories is fully discarded -> no change
  const { enriched, rejected } = mergeEnrichment(base, {
    claim_categories: { competitor_benchmarks: ['competitor X averages 2400 words'] },
  })
  assert.ok(!enriched.includes('claim_categories'), 'claimed enrichment with zero change')
  assert.ok(rejected.some((r) => r.reason === 'no change after guarding'))
})

test('a descriptive claim with no identifier passes through untouched', () => {
  const { value, stripped } = stripUnverifiableIdentifiers('Prevalence of rug pulls among 2024 token launches')
  assert.equal(stripped, false)
  assert.equal(value, 'Prevalence of rug pulls among 2024 token launches')
})

test('claim_categories: fabricated citations are stripped and reported', () => {
  const base = assembled()
  const { brief, rejected } = mergeEnrichment(base, {
    claim_categories: {
      clinical_evidence: ['Smith et al 2023 PMID: 98765432'],
      regulatory_status: ['SEC Rule 10b-5 (2024)'],
    },
  })
  assert.ok(brief.claim_categories.clinical_evidence[0].includes(PLACEHOLDER.UNVERIFIED))
  assert.ok(!brief.claim_categories.clinical_evidence[0].includes('98765432'))
  assert.equal(brief.claim_categories.regulatory_status[0], 'SEC Rule 10b-5 (2024)') // no identifier, kept
  assert.ok(rejected.some((r) => r.field === 'claim_categories'))
})

test('claim_categories.competitor_benchmarks always stays [NO DATA]', () => {
  const { brief, rejected } = mergeEnrichment(assembled(), {
    claim_categories: { competitor_benchmarks: ['competitor X averages 2400 words'] },
  })
  assert.deepEqual(brief.claim_categories.competitor_benchmarks, [PLACEHOLDER.NO_DATA])
  assert.ok(rejected.some((r) => r.field === 'claim_categories.competitor_benchmarks'))
})

// ── Heading structure guard ──────────────────────────────────────────────────
test('measured PAA headings keep their h2 text and provenance', () => {
  const base = assembled()
  const paaH2 = base.heading_structure.find((h) => h._seed_source === 'serp_paa').h2
  const { brief } = mergeEnrichment(base, {
    heading_structure: [{ h2: paaH2, starting_statement: 'A rug pull is a token exit scam.', format: 'Paragraph', context_terms: ['liquidity'] }],
  })
  const row = brief.heading_structure.find((h) => h.h2 === paaH2)
  assert.equal(row._seed_source, 'serp_paa')
  assert.equal(row.starting_statement, 'A rug pull is a token exit scam.')
  assert.equal(row.format, 'Paragraph')
})

test('a model cannot rename or drop a measured/mandatory heading', () => {
  const base = assembled()
  const before = base.heading_structure.map((h) => h.h2)
  const { brief } = mergeEnrichment(base, { heading_structure: [{ h2: 'Something Entirely Different' }] })
  for (const h2 of before) assert.ok(brief.heading_structure.some((h) => h.h2 === h2), `lost heading ${h2}`)
  assert.equal(brief.heading_structure.filter((h) => h._mandatory).length, 2)
})

test('model-added headings are tagged llm so they are distinguishable from measured', () => {
  const base = assembled()
  const { brief } = mergeEnrichment(base, {
    heading_structure: [{ h2: 'How To Verify Liquidity Locks', starting_statement: 'Check the lock contract.' }],
  })
  const added = brief.heading_structure.find((h) => h.h2 === 'How To Verify Liquidity Locks')
  assert.equal(added._seed_source, 'llm')
  assert.equal(added.starting_statement, 'Check the lock contract.')
  assert.equal(added.heading_level, 'H2')
})

test('per-heading source_ledger_seeds are identifier-guarded too', () => {
  const base = assembled()
  const paaH2 = base.heading_structure.find((h) => h._seed_source === 'serp_paa').h2
  const { brief } = mergeEnrichment(base, {
    heading_structure: [{ h2: paaH2, source_ledger_seeds: ['Chainalysis report https://chainalysis.com/x'] }],
  })
  const row = brief.heading_structure.find((h) => h.h2 === paaH2)
  assert.ok(row.source_ledger_seeds[0].includes(PLACEHOLDER.UNVERIFIED))
  assert.ok(!row.source_ledger_seeds[0].includes('https://'))
})

// ── Normal enrichment + robustness ───────────────────────────────────────────
test('enrichable creative fields are written through', () => {
  const { brief, enriched } = mergeEnrichment(assembled(), {
    title_tag: 'How Rug Pulls Work: The Exit-Scam Playbook',
    meta_description: 'Rug pulls drain liquidity after hype peaks. Here is the mechanism and the warning signs.',
    bluf_target: 'A rug pull is a token exit scam in which developers drain the liquidity pool.',
    predicates: ['rug pull drains liquidity pool'],
  })
  assert.equal(brief.title_tag, 'How Rug Pulls Work: The Exit-Scam Playbook')
  assert.deepEqual(brief.predicates, ['rug pull drains liquidity pool'])
  assert.ok(enriched.includes('title_tag'))
  assert.ok(ENRICHABLE.includes('title_tag'))
})

test('empty/blank model values are rejected, leaving the placeholder intact', () => {
  const base = assembled()
  const { brief, rejected } = mergeEnrichment(base, { title_tag: '   ', meta_description: null })
  assert.equal(brief.title_tag, PLACEHOLDER.PENDING_LLM)
  assert.equal(brief.meta_description, PLACEHOLDER.PENDING_LLM)
  assert.equal(rejected.filter((r) => r.reason === 'empty value').length, 2)
})

test('malformed llm output never throws and changes nothing', () => {
  const base = assembled()
  for (const bad of [null, undefined, 'nope', 42, ['a']]) {
    const { brief, enriched } = mergeEnrichment(base, bad)
    assert.deepEqual(enriched, [])
    assert.equal(brief.title_tag, PLACEHOLDER.PENDING_LLM)
  }
})

// ── Prompt ───────────────────────────────────────────────────────────────────
test('prompt states the honesty rules and pins the measured headings verbatim', () => {
  const base = assembled()
  const { system, user } = buildEnrichmentPrompt(base, TOPIC)
  assert.match(system, /NEVER invent a PMID/)
  assert.match(system, /NEVER output competitor metrics/)
  assert.match(system, /NEVER output a Wikidata Q-ID/)
  assert.ok(system.includes(PLACEHOLDER.UNVERIFIED))
  assert.match(user, /What is a rug pull\?/)
  assert.match(user, /keep verbatim/)
  assert.match(user, /MANDATORY/)
})

test('prompt carries the human-supplied non-commodity angle', () => {
  const base = assembleBrief({
    topic: TOPIC, created: '2026-07-19',
    sullivan: { content_type: 'firsthand_review', forcing_inputs: { recurring_pattern: 'Liquidity pulled within 72h of launch' } },
  })
  const { user } = buildEnrichmentPrompt(base, TOPIC)
  assert.match(user, /firsthand_review/)
  assert.match(user, /Liquidity pulled within 72h/)
})
