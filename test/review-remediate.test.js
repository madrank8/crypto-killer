const { test } = require('node:test'); const assert = require('node:assert/strict')
const { remediateStatLiterals, filterRosterToGroundTruth, pruneIncompleteFaqs, findOffRosterNames, dropOffRosterImpersonation, remediateReview, nameKey } = require('../lib/review-remediate')

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

// ── incomplete-FAQ pruning (truncated JSON-LD guard) ────────────────────────
test('a truncated final FAQ answer (no terminal punctuation) is dropped', () => {
  const faq = [
    { question: 'Is it a scam?', answer: 'Yes. The platform shows every hallmark of an advance-fee fraud.' },
    { question: 'How do they reach victims?', answer: 'They run paid ads that impersonate public figures and then' }, // cut off
  ]
  const { faq: kept, dropped } = pruneIncompleteFaqs(faq)
  assert.equal(kept.length, 1)
  assert.equal(kept[0].question, 'Is it a scam?')
  assert.deepEqual(dropped, ['How do they reach victims?'])
})

test('complete answers are kept; punctuation + closing quote/paren counts as complete', () => {
  const faq = [
    { question: 'A?', answer: 'A finished sentence.' },
    { question: 'B?', answer: 'It ends with a quote."' },
    { question: 'C?', answer: 'It ends with a paren (like this).' },
    { question: 'D?', answer: 'A question inside? Yes!' },
  ]
  const { faq: kept, dropped } = pruneIncompleteFaqs(faq)
  assert.equal(kept.length, 4)
  assert.deepEqual(dropped, [])
})

test('empty / missing answer or question is dropped', () => {
  const faq = [
    { question: 'Has answer', answer: '' },
    { question: '', answer: 'Orphan answer.' },
    { question: 'No answer key' },
    { question: 'Good one', answer: 'Kept.' },
  ]
  const { faq: kept, dropped } = pruneIncompleteFaqs(faq)
  assert.equal(kept.length, 1)
  assert.equal(kept[0].question, 'Good one')
})

test('pruneIncompleteFaqs never throws on malformed input', () => {
  for (const bad of [null, undefined, 'x', 42, [null, 'str', { }]]) {
    assert.doesNotThrow(() => pruneIncompleteFaqs(bad))
  }
})

test('remediateReview drops a truncated FAQ and reports it', () => {
  const review = {
    faq: [
      { question: 'Complete?', answer: 'Absolutely, this one is finished.' },
      { question: 'Truncated?', answer: 'This answer was cut off right in the mid' },
    ],
  }
  const { review: fixed, report } = remediateReview(review, { brand: BRAND, groundTruthNames: GT })
  assert.equal(fixed.faq.length, 1)
  assert.deepEqual(report.faq_dropped, ['Truncated?'])
})

// ── off-roster impersonation guard (real quantum-ai fixtures) ───────────────
// Roster is a SUBSET of the real 181-name quantum-ai roster: these four ARE in
// it; Pauline Hanson / Sudha Murthy / Narayana Murthy are NOT.
const QAI_ROSTER = ['Elon Musk', 'Bill Gates', 'Nigel Farage', 'Nirmala Sitharaman', 'Cristiano Ronaldo', 'Ana Botín']

test('drops a bullet naming off-roster people (Sudha/Narayana Murthy)', () => {
  const sig = 'The same India-targeted creatives recycle Sudha Murthy, Narayana Murthy, and Finance Minister Nirmala Sitharaman together, pairing a trusted philanthropist face with a sitting official.'
  const names = findOffRosterNames(sig, new Set(QAI_ROSTER.map(nameKey)))
  // Sitharaman is roster-backed even behind the "Finance Minister" title; only
  // the two genuinely-absent names are flagged.
  assert.deepEqual(names.sort(), ['Narayana Murthy', 'Sudha Murthy'])
})

test('KEEPS a bullet whose only names are roster-backed, incl. non-Latin script', () => {
  // Musk + Gates are roster names; the Greek-script transliterations must NOT
  // be adjudicated (roster is Latin) → nothing flagged, bullet survives.
  const sig = 'The Greek creatives render Elon Musk and Bill Gates in Greek script (Ίλον Μασκ, Μπιλ Γκέιτς) rather than reusing English assets.'
  assert.deepEqual(findOffRosterNames(sig, new Set(QAI_ROSTER.map(nameKey))), [])
})

test('an impersonation FAQ naming only roster people is kept; one with an off-roster name is dropped', () => {
  const faq = [
    { question: 'My family says Quantum AI was endorsed by Elon Musk — real?',
      answer: 'The endorsements are fabricated. Quantum AI impersonates public figures including Elon Musk and Bill Gates using deepfake video.' },
    { question: 'Why does Quantum AI use Nigel Farage and Pauline Hanson in its ads?',
      answer: 'Quantum AI targets audiences by impersonating trusted local figures like Nigel Farage and Pauline Hanson.' },
  ]
  const { faq: kept, dropped } = dropOffRosterImpersonation({ faq }, QAI_ROSTER, 'Quantum AI')
  assert.equal(kept.length, 1)
  assert.match(kept[0].question, /Elon Musk/)               // Musk+Gates FAQ survives
  assert.equal(dropped.length, 1)
  assert.deepEqual(dropped[0].names, ['Pauline Hanson'])    // Farage is roster-backed, only Hanson flagged
})

test('an FCA-registration FAQ (org names, no impersonation trigger) is never scanned/dropped', () => {
  const faq = [{
    question: 'Is Quantum AI registered with the FCA?',
    answer: 'Quantum AI holds no FCA registration. Trading with an unauthorised firm means no access to the Financial Ombudsman Service or the Financial Services Compensation Scheme.',
  }]
  const { faq: kept, dropped } = dropOffRosterImpersonation({ faq }, QAI_ROSTER, 'Quantum AI')
  assert.equal(kept.length, 1)
  assert.deepEqual(dropped, [])
})

test('no roster (empty) → never drops anything (never guess)', () => {
  const faq = [{ question: 'Who?', answer: 'Impersonates Pauline Hanson via deepfake.' }]
  const { dropped } = dropOffRosterImpersonation({ faq }, [], 'Quantum AI')
  assert.deepEqual(dropped, [])
})

test('brand-name tokens are never treated as impersonation victims', () => {
  // "Quantum AI" is capitalised and could look like a name; it must not flag.
  const sig = 'Quantum AI deepfakes celebrity endorsements across its ad network.'
  assert.deepEqual(findOffRosterNames(sig, new Set(QAI_ROSTER.map(nameKey)), new Set(['quantum', 'ai'])), [])
})

test('remediateReview drops off-roster impersonation items and reports them', () => {
  const review = {
    experience_signals: [
      'The operator tailors the celebrity to the geo, Nigel Farage for GB and Pauline Hanson for AU, matching each market to a familiar face.',
      'Most captured creatives are video, the format that best fakes a broadcast interview.',
    ],
    faq: [
      { question: 'Endorsed by Elon Musk?', answer: 'Quantum AI impersonates Elon Musk and Bill Gates via deepfake. Fabricated.' },
    ],
  }
  const { review: fixed, report } = remediateReview(review, { brand: { name: 'Quantum AI' }, groundTruthNames: QAI_ROSTER })
  assert.equal(fixed.experience_signals.length, 1)              // Hanson bullet dropped, video bullet kept
  assert.match(fixed.experience_signals[0], /video/)
  assert.equal(fixed.faq.length, 1)                            // Musk+Gates FAQ kept
  assert.equal(report.impersonation_dropped.length, 1)
  assert.deepEqual(report.impersonation_dropped[0].names, ['Pauline Hanson'])
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
