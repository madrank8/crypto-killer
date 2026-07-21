const { test } = require('node:test'); const assert = require('node:assert/strict')
const { remediateStatLiterals, filterRosterToGroundTruth, remediateReview, nameKey } = require('../lib/review-remediate')

const BRAND = { total_creatives: 4846, total_geos: 49, velocity_7d: 157 }

// ── value-anchored stat tokenisation (the safety core) ──────────────────────
test('a literal that EQUALS this brand stat is tokenised', () => {
  const { text, changes } = remediateStatLiterals('We logged 4,846 ad creatives across the campaign.', BRAND)
  assert.equal(text, 'We logged {{stat:ad_creatives}} ad creatives across the campaign.')
  assert.deepEqual(changes, [{ field: 'text', from: '4,846', token: '{{stat:ad_creatives}}' }])
})

test('a platform figure that does NOT equal this brand stat is left untouched', () => {
  // brand targets 49 geos; "90+ countries" is the platform reach — must NOT tokenise.
  const { text, changes } = remediateStatLiterals('scanned across 90+ countries platform-wide', BRAND)
  assert.equal(text, 'scanned across 90+ countries platform-wide')
  assert.deepEqual(changes, [])
})

test('the CORRECT brand geo value IS tokenised', () => {
  assert.equal(remediateStatLiterals('ads in 49 countries', BRAND).text, 'ads in {{stat:countries_targeted}} countries')
})

test('celebrities anchor on the DEDUPED count, not raw total_celebrities', () => {
  // ground truth list has 178 names; token resolves to 178. total_celebrities (353) is irrelevant.
  const { text } = remediateReview(
    { summary: 'impersonating 178 celebrities' },
    { brand: { ...BRAND, total_celebrities: 353 }, groundTruthNames: Array.from({ length: 178 }, (_, i) => `Name ${i}`) }
  ).review
    ? remediateStatLiterals('impersonating 178 celebrities', { ...BRAND, celeb_count: 178 })
    : { text: '' }
  assert.equal(text, 'impersonating {{stat:celebrities_abused}} celebrities')
  // and 353 (the raw count) is NOT tokenised
  assert.equal(remediateStatLiterals('353 celebrities', { ...BRAND, celeb_count: 178 }).text, '353 celebrities')
})

test('a non-stat number is never touched', () => {
  const t = 'Minimum deposit $4,846 and 49 victims filed reports.' // same numbers, wrong nouns
  assert.equal(remediateStatLiterals(t, BRAND).text, t)
})

test('no brand value for a stat -> never tokenise (never guess)', () => {
  const { text } = remediateStatLiterals('4,846 ad creatives in 49 countries', { total_geos: 49 })
  // only geo has a value → only countries tokenised; creatives left (no value)
  assert.match(text, /4,846 ad creatives/)
  assert.match(text, /\{\{stat:countries_targeted\}\} countries/)
})

test('already-tokenised text is idempotent', () => {
  const t = '{{stat:ad_creatives}} ad creatives across {{stat:countries_targeted}} countries'
  assert.equal(remediateStatLiterals(t, BRAND).text, t)
})

// ── roster filter (structured, safe) ────────────────────────────────────────
const GT = ['Elon Musk', 'Martin Lewis', 'Haruhiko Kuroda']

test('fabricated roster names are dropped; ground-truth names kept; positions + count fixed', () => {
  const list = { name: 'Roster', numberOfItems: 4, items: [
    { position: 1, name: 'Elon Musk' },
    { position: 2, name: 'Sudha Murthy' },       // fabricated
    { position: 3, name: 'Martin Lewis' },
    { position: 4, name: 'Pauline Hanson' },     // fabricated
  ] }
  const { itemList, dropped } = filterRosterToGroundTruth(list, GT)
  assert.deepEqual(itemList.items.map((i) => i.name), ['Elon Musk', 'Martin Lewis'])
  assert.deepEqual(itemList.items.map((i) => i.position), [1, 2])
  assert.equal(itemList.numberOfItems, 2)
  assert.deepEqual(dropped, ['Sudha Murthy', 'Pauline Hanson'])
})

test('roster match is case/space/diacritic-insensitive', () => {
  const list = { items: [{ name: 'elon  musk' }, { name: 'Haruhiko KURODA' }] }
  const { itemList, dropped } = filterRosterToGroundTruth(list, GT)
  assert.equal(itemList.items.length, 2)
  assert.deepEqual(dropped, [])
})

test('empty ground truth -> roster untouched (never guess what is real)', () => {
  const list = { items: [{ name: 'Someone' }], numberOfItems: 1 }
  const { itemList, dropped } = filterRosterToGroundTruth(list, [])
  assert.deepEqual(itemList.items, [{ name: 'Someone' }])
  assert.deepEqual(dropped, [])
})

test('nameKey normalises', () => {
  assert.equal(nameKey('Élon  Musk!'), 'elon musk')
  assert.equal(nameKey(''), '')
})

// ── remediateReview end-to-end ──────────────────────────────────────────────
test('remediateReview tokenises text fields and filters the roster, reporting both', () => {
  const review = {
    summary: 'Across 4,846 ad creatives in 49 countries.',
    red_flags: [{ flag: 'Scale', detail: 'Deployed 4,846 ad creatives targeting 49 countries.' }],
    faq: [{ question: 'How big?', answer: 'They ran 4,846 ad creatives.' }],
    item_list: { items: [{ name: 'Elon Musk' }, { name: 'Fake Person' }], numberOfItems: 2 },
    unrelated_field: 'keep 4,846 creatives here untouched', // not in TEXT_FIELDS
  }
  const { review: fixed, report } = remediateReview(review, { brand: BRAND, groundTruthNames: GT })
  assert.match(fixed.summary, /\{\{stat:ad_creatives\}\}.*\{\{stat:countries_targeted\}\}/)
  assert.match(fixed.red_flags[0].detail, /\{\{stat:ad_creatives\}\}/)
  assert.match(fixed.faq[0].answer, /\{\{stat:ad_creatives\}\}/)
  assert.deepEqual(fixed.item_list.items.map((i) => i.name), ['Elon Musk'])
  assert.equal(fixed.item_list.numberOfItems, 1)
  assert.equal(fixed.unrelated_field, 'keep 4,846 creatives here untouched') // untouched
  assert.ok(report.tokenized.length >= 3)
  assert.deepEqual(report.roster_dropped, ['Fake Person'])
})

test('remediateReview never throws on malformed input', () => {
  for (const bad of [null, undefined, 'x', 42, { item_list: 'nope', summary: 5 }]) {
    assert.doesNotThrow(() => remediateReview(bad, { brand: null }))
  }
})

test('remediateReview with no brand values changes nothing but does not crash', () => {
  const review = { summary: '4,846 ad creatives' }
  const { review: fixed } = remediateReview(review, {})
  assert.equal(fixed.summary, '4,846 ad creatives') // no brand value → no tokenisation
})
