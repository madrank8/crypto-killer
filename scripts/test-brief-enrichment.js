#!/usr/bin/env node
/**
 * Live smoke test for content-brief LLM enrichment.
 *
 *   node scripts/test-brief-enrichment.js --dry-run   # canned adversarial response, no API call
 *   node scripts/test-brief-enrichment.js             # real Sonnet call (needs ANTHROPIC_API_KEY)
 *
 * Exercises the one path that unit tests cannot cover: a REAL model response
 * flowing through the real guard. Prints what the model wrote, and — the part that
 * matters — what the guard BLOCKED. That list is the calibration signal: if the
 * guard is stripping things it shouldn't, the patterns in lib/content-brief/enrich.js
 * are the dial.
 *
 * Touches no database and persists nothing, so it cannot pollute production data
 * with the placeholder evidence below.
 */
'use strict'

const fs = require('fs')
const path = require('path')

// Load .env.local if present (the app's normal source of keys).
const envPath = path.join(process.cwd(), '.env.local')
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}

const { assembleBrief } = require('../lib/content-brief/assemble')
const { validateSullivanGate } = require('../lib/content-brief/sullivan')
const { buildEnrichmentPrompt, mergeEnrichment } = require('../lib/content-brief/enrich')
const { toYaml } = require('../lib/content-brief/yaml')

const DRY = process.argv.includes('--dry-run')
const SHOW_YAML = process.argv.includes('--yaml')

// A realistic post-migration topic (shape matches what stageSave persists).
const TOPIC = {
  id: 'smoke-test', title: 'How Crypto Rug Pulls Work', slug: 'how-rug-pulls-work',
  url_path: '/crypto-scams/rug-pulls/', target_keyword: 'how rug pulls work',
  secondary_keywords: ['rug pull warning signs', 'liquidity lock check'],
  section: 'core', topic_type: 'cluster', node_type: 'standard', node_function: 'reinforcement',
  priority_score: 75, search_intent: 'informational', content_format: 'Evergreen Article',
  schema_type: 'Article',
  paa_questions: ['What is a rug pull?', 'How do I spot a rug pull before investing?'],
  serp_features: ['ai_overview', 'people_also_ask'], serp_authority: { dr_median: 55, dr_min: 21 },
  competitor_urls: ['https://rival-example.com/rug-pulls'],
  internal_links_to: ['spot-a-scam'], dependencies: ['crypto-scams'],
}

// PLACEHOLDER evidence for the smoke test only. Real briefs must use real
// forcing inputs — see docs/content-brief.md.
const SULLIVAN = {
  content_type: 'firsthand_review',
  forcing_inputs: {
    direct_anecdotes: [
      'SMOKE TEST — withdrawal blocked hours after the pool drained',
      'SMOKE TEST — support channel deleted the same day',
      'SMOKE TEST — contract owner re-minted after renouncing',
    ],
    field_observation_count: 'SMOKE TEST — 400 callouts since 2019',
    recurring_pattern: 'SMOKE TEST — liquidity pulled within 72h of launch',
    credentials: 'SMOKE TEST — lead investigator, 6 years',
  },
}

// A deliberately hostile response: every honesty rule attacked at once.
const ADVERSARIAL = {
  title_tag: 'How Crypto Rug Pulls Work: The Complete 2026 Playbook',
  meta_description: 'Rug pulls drain liquidity after hype peaks. Learn the mechanism, the warning signs, and what to do if you are hit.',
  bluf_target: 'A rug pull is a token exit scam in which developers drain the liquidity pool after promoting the token, leaving holders unable to sell.',
  predicates: ['Rug pull drains the liquidity pool', 'Documented under PMID:87654321'],
  key_entities: [{ entity: 'SEC', attribute: 'wikidata', value: 'Q99999999' }],
  visual_assets: [{ type: 'chart', description: 'Competitor pages average DR 71 and 3,200 words', alt_text: 'See ahrefs.com/reports/rug-pulls', placement: 'after What is a rug pull?' }],
  outbound_link_targets: ['sec.gov/litigation/litreleases/2024/lr99999 — enforcement precedent', 'chainalysis.com'],
  claim_categories: { regulatory_status: ['SEC enforcement posture on token launches'], clinical_evidence: ['Smith et al 2023 doi:10.1234/fake.5678'] },
  // direct attacks on protected fields:
  competitor_benchmarks: { word_count: '3,200 words', avg_dr: 'DR 71' },
  entity_wikidata: 'Q12345678',
  search_intent: 'T',
  experience_angle: 'A first-hand story the model made up',
  forcing_inputs: { direct_anecdotes: ['fabricated'] },
}

async function main() {
  const gate = validateSullivanGate(SULLIVAN)
  if (!gate.ok) {
    console.error('Sullivan gate failed:', gate.missing)
    process.exit(1)
  }

  const base = assembleBrief({
    topic: TOPIC,
    parentTopic: { title: 'Crypto Scams', url_path: '/crypto-scams/' },
    siteUrl: 'https://cryptokiller.org',
    created: new Date().toISOString().slice(0, 10),
    sullivan: SULLIVAN,
    publication: { week: 2, target_date: '2026-07-27', order: 3 },
    slugToPath: { 'spot-a-scam': '/guides/spot-a-scam/', 'crypto-scams': '/crypto-scams/' },
  })

  const { system, user } = buildEnrichmentPrompt(base, TOPIC)
  console.log(`\n=== MODE: ${DRY ? 'dry run (canned adversarial response, no API call)' : 'LIVE Sonnet call'} ===`)
  console.log(`prompt size: system ${system.length} chars, user ${user.length} chars`)

  let raw
  if (DRY) {
    raw = ADVERSARIAL
  } else {
    if (!process.env.ANTHROPIC_API_KEY) {
      console.error('\nANTHROPIC_API_KEY is not set. Add it to .env.local or export it, or run with --dry-run.')
      process.exit(1)
    }
    const { callModel, extractJSON } = require('../lib/ai-models')
    const started = Date.now()
    const res = await callModel('claude-sonnet', system, user, { timeoutMs: 120000 })
    console.log(`model responded in ${((Date.now() - started) / 1000).toFixed(1)}s (${res.resolvedModel || 'claude-sonnet'})`)
    raw = extractJSON(res.text)
    if (!raw || typeof raw !== 'object') {
      console.error('Model did not return parseable JSON. First 400 chars:\n', String(res.text).slice(0, 400))
      process.exit(1)
    }
    console.log(`model returned keys: ${Object.keys(raw).join(', ')}`)
  }

  const { brief, enriched, rejected } = mergeEnrichment(base, raw)

  console.log(`\n=== ENRICHED (${enriched.length}) ===`)
  for (const f of enriched) {
    const v = brief[f]
    const preview = typeof v === 'string' ? v : JSON.stringify(v)
    console.log(`  ${f}: ${String(preview).slice(0, 120)}${String(preview).length > 120 ? '…' : ''}`)
  }

  console.log(`\n=== BLOCKED BY THE HONESTY GUARD (${rejected.length}) ===`)
  console.log('    ↳ this is the calibration signal — read it carefully')
  for (const r of rejected) {
    console.log(`  ${r.field}: ${r.reason}`)
    if (r.original) console.log(`      was: ${String(r.original).slice(0, 110)}`)
  }

  console.log('\n=== INVARIANTS (must all hold) ===')
  const checks = [
    ['competitor_benchmarks untouched', brief.competitor_benchmarks.word_count.startsWith('[NO DATA')],
    ['entity_wikidata untouched', brief.entity_wikidata === base.entity_wikidata],
    ['search_intent untouched', brief.search_intent === base.search_intent],
    ['forcing_inputs untouched', JSON.stringify(brief.forcing_inputs) === JSON.stringify(base.forcing_inputs)],
    ['experience_angle still human-supplied', brief.experience_angle === base.experience_angle],
    ['no PMID anywhere', !JSON.stringify(brief).match(/pmc?id\s*:?\s*\d+/i)],
    ['no DOI anywhere', !JSON.stringify(brief).match(/10\.\d{4,9}\//)],
    ['no fabricated Q-ID', !JSON.stringify(brief).match(/Q\d{4,}/)],
    ['measured PAA headings preserved', TOPIC.paa_questions.every((q) => brief.heading_structure.some((h) => h.h2 === q))],
    ['both mandatory headings present', brief.heading_structure.filter((h) => h._mandatory).length === 2],
  ]
  let failed = 0
  for (const [label, ok] of checks) {
    if (!ok) failed++
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`)
  }

  if (SHOW_YAML) {
    console.log('\n=== YAML HANDOFF ===')
    console.log(toYaml(brief))
  } else {
    console.log('\n(run with --yaml to print the full handoff document)')
  }

  console.log(`\n${failed === 0 ? 'All invariants held.' : `${failed} INVARIANT(S) FAILED — investigate before using enrichment.`}`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => { console.error('\nFailed:', e.message); process.exit(1) })
