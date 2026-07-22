const { test } = require('node:test'); const assert = require('node:assert/strict')
const { pickItemReviewedType, buildReviewSchema } = require('../lib/review-schema')

// pickItemReviewedType — the editorial type is the authority, mapped to a
// Google-valid @type; brand entity_type is the fallback.
test('editorial item_reviewed.type wins over a disagreeing brand entity_type', () => {
  // The quantum-ai incident: brand stored as SoftwareApplication, editorial
  // (evidence-grounded) says FinancialProduct → schema must follow editorial,
  // mapped FinancialProduct → Product.
  const rc = { item_reviewed: { type: 'FinancialProduct' } }
  const brand = { entity_type: 'SoftwareApplication' }
  assert.equal(pickItemReviewedType(rc, brand), 'Product')
})

test('falls back to brand entity_type when the editorial type is missing/unknown', () => {
  assert.equal(pickItemReviewedType({}, { entity_type: 'SoftwareApplication' }), 'SoftwareApplication')
  assert.equal(pickItemReviewedType({ item_reviewed: { type: 'Nonsense' } }, { entity_type: 'Service' }), 'Organization')
  assert.equal(pickItemReviewedType({ item_reviewed: {} }, { entity_type: 'LocalBusiness' }), 'LocalBusiness')
})

test('falls back to Organization when neither source is usable', () => {
  assert.equal(pickItemReviewedType({}, {}), 'Organization')
  assert.equal(pickItemReviewedType(null, null), 'Organization')
})

test('editorial type is trimmed before lookup (distinguishes trim from fallback)', () => {
  // With trim: '  FinancialProduct  ' → 'FinancialProduct' → 'Product'.
  // Without trim: unknown key → falls back to brand entity_type ('SoftwareApplication').
  // Asserting 'Product' proves .trim() actually runs.
  assert.equal(
    pickItemReviewedType({ item_reviewed: { type: '  FinancialProduct  ' } }, { entity_type: 'SoftwareApplication' }),
    'Product',
  )
})

// End-to-end: the built graph's Review.itemReviewed and WebPage.about[0] agree.
test('buildReviewSchema: Review.itemReviewed and WebPage.about share one @type', () => {
  const graph = buildReviewSchema({
    reviewContent: {
      item_reviewed: { type: 'FinancialProduct', name: 'Quantum AI' },
      verdict: 'A scam.',
      faq: [],
    },
    brandData: { name: 'Quantum AI', entity_type: 'SoftwareApplication', scam_score: 95, total_creatives: 10, total_geos: 5 },
    slug: 'quantum-ai',
    currentDate: '2026-07-21',
    wordCount: 2000,
    longevityDays: 120,
    threat: { tier: 'confirmed', score: 95, frameAsScam: true },
  })['@graph']

  const review = graph.find((n) => n['@type'] === 'Review')
  const webpage = graph.find((n) => Array.isArray(n.about))
  assert.equal(review.itemReviewed['@type'], 'Product')          // mapped from editorial FinancialProduct
  assert.equal(webpage.about[0]['@type'], 'Product')             // and WebPage.about agrees
  assert.notEqual(review.itemReviewed['@type'], 'SoftwareApplication') // NOT the stale brand type
})
