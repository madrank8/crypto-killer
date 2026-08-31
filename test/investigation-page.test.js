'use strict'

/**
 * Structural guards on the rendered investigation template.
 *
 * A React server component that fetches from Supabase cannot be mounted in a
 * plain node:test run, so these assert the properties the Phase 1 rebuild is
 * actually trying to hold: that the page reads the CANONICAL record rather
 * than raw columns, that it never prints a classification the number alone
 * decided, and that the blocks the brief specifies are present.
 *
 * They fail loudly the moment someone reintroduces a direct `brand.total_*`
 * read into the template — which is exactly how the three-way score
 * disagreement got onto the live site in the first place.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const PAGE = path.join(process.cwd(), 'app', 'review', '[slug]', 'page.js')
const src = fs.readFileSync(PAGE, 'utf8')

/** The JSX body only — imports and the data-fetch selects are allowed to name columns. */
const jsx = src.slice(src.indexOf('return ('))

/** Comments explain what the old code did; only executable source is checked. */
const stripComments = (t) =>
  t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')
const jsxCode = stripComments(jsx)

test('the template builds the canonical investigation record', () => {
  assert.match(src, /buildInvestigation\(\{ review, brand \}\)/)
})

test('no displayed metric is read straight off the brand row', () => {
  for (const raw of ['brand.total_creatives', 'brand.total_geos', 'brand.total_celebrities', 'brand.scam_score', 'review.scam_score']) {
    assert.equal(jsxCode.includes(raw), false, `${raw} is rendered directly instead of through the canonical record`)
  }
})

test('days_active is not re-derived in the template', () => {
  assert.equal(/new Date\(brand\.last_seen_at\)\s*-\s*new Date\(brand\.first_seen_at\)/.test(src), false)
  assert.match(src, /investigation\.days_active/)
})

test('the classification badge is driven by the record, not by a score threshold', () => {
  assert.match(src, /function RiskBadge\(\{ investigation \}\)/)
  // The old implementation printed this string from `score >= 70`.
  assert.equal(/CONFIRMED SCAM\s*$/m.test(jsxCode), false, 'a hardcoded CONFIRMED SCAM label is back in the template')
  assert.match(jsx, /<RiskBadge investigation=\{investigation\} \/>/)
})

test('the H1 is question-shaped and names the brand', () => {
  assert.match(jsx, /\{investigation\.brand_name\} Review: Is \{investigation\.brand_name\} a Scam\?/)
})

test('the blocks the brief specifies are rendered', () => {
  for (const [label, needle] of [
    ['Current assessment', '<CurrentAssessment investigation={investigation} />'],
    ['Evidence Snapshot', '<EvidenceSnapshot investigation={investigation} />'],
    ['Why We Assigned This Score', 'Why We Assigned This Score'],
    ['Evidence legend', '<EvidenceLegend'],
    ['Evidence findings', '<EvidenceList items={evidenceFindings} />'],
    ['Contextual links', 'data-link-context'],
    ['FAQ', 'FaqAccordion'],
  ]) {
    assert.ok(jsx.includes(needle), `${label} block missing from the template`)
  }
})

test('evidence findings prefer analyst-authored items over derived ones', () => {
  assert.match(src, /authoredEvidence\.length > 0 \? authoredEvidence : derivedObservedFindings\(investigation\)/)
})

test('the brand query selects every column the canonical record needs', () => {
  const select = src.slice(src.indexOf('/scam_brands?id=eq.'), src.indexOf('`', src.indexOf('/scam_brands?id=eq.')))
  for (const col of [
    'celebrity_list', 'geo_list', 'first_seen_at', 'last_seen_at', 'lifespan_days',
    'primary_domain', 'regulator_warnings', 'victim_reports', 'classification_override',
  ]) {
    assert.ok(select.includes(col), `brand select is missing ${col}`)
  }
})

test('the snapshot table rows are machine-readable', () => {
  const snapshot = fs.readFileSync(path.join(process.cwd(), 'components', 'investigation', 'EvidenceSnapshot.js'), 'utf8')
  assert.match(snapshot, /<table/)
  assert.match(snapshot, /data-canonical-field=\{r\.key\}/)
  assert.match(snapshot, /<caption/)
  assert.match(snapshot, /scope="row"/)
})

test('the evidence label renders its class as text, not only as colour', () => {
  const label = fs.readFileSync(path.join(process.cwd(), 'components', 'investigation', 'EvidenceLabel.js'), 'utf8')
  assert.match(label, /\{cls\.label\}/)
  assert.match(label, /data-evidence-class=\{cls\.key\}/)
})
