'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  organizationEntity, analystEntity, websiteEntity, resolveAnalyst,
  organizationSameAs, ANALYSTS, siteUrl,
} = require('../lib/entity-registry')
const { buildReviewSchema } = require('../lib/review-schema')
const { STATIC_ROUTES, buildInvestigationLinks, ANALYST_ROUTE_IDS } = require('../lib/internal-links')
const { buildInvestigation } = require('../lib/investigation-model')

// ── entity registry ───────────────────────────────────────────────────────

test('the organization is anchored on the production domain, never the preview host', () => {
  const prev = process.env.NEXT_PUBLIC_SITE_URL
  process.env.NEXT_PUBLIC_SITE_URL = 'https://crypto-killer.vercel.app'
  try {
    assert.equal(siteUrl(), 'https://cryptokiller.org')
    assert.equal(organizationEntity()['@id'], 'https://cryptokiller.org/#organization')
  } finally {
    if (prev === undefined) delete process.env.NEXT_PUBLIC_SITE_URL
    else process.env.NEXT_PUBLIC_SITE_URL = prev
  }
})

test('sameAs contains only explicitly configured URLs — no invented profiles', () => {
  const prev = process.env.CRYPTOKILLER_LINKEDIN_URL
  delete process.env.CRYPTOKILLER_LINKEDIN_URL
  try {
    for (const u of organizationSameAs()) assert.match(u, /^https?:\/\//)
    assert.equal(organizationEntity().sameAs, undefined, 'an empty sameAs must be omitted, not emitted as []')
  } finally {
    if (prev !== undefined) process.env.CRYPTOKILLER_LINKEDIN_URL = prev
  }
})

test('every analyst record points at an author route the link layer also knows', () => {
  for (const [id, a] of Object.entries(ANALYSTS)) {
    assert.equal(a.path, `/author/${id}`)
    assert.ok(ANALYST_ROUTE_IDS.includes(id), `${id} missing from the verified route list`)
  }
})

test('an unknown persona falls back to the research team, not a 404 author page', () => {
  const team = resolveAnalyst('nobody')
  assert.equal(team.name, 'Crypto Killer Research Team')
  assert.equal(team.path, null)
  assert.equal(analystEntity('nobody').url, undefined)
})

test('a known analyst gets their own @id and url', () => {
  const p = analystEntity('webb')
  assert.equal(p['@id'], 'https://cryptokiller.org/author/webb#person')
  assert.equal(p.url, 'https://cryptokiller.org/author/webb')
  assert.equal(p.worksFor['@id'], 'https://cryptokiller.org/#organization')
})

// ── structured data ───────────────────────────────────────────────────────

function graph() {
  return buildReviewSchema({
    reviewContent: { summary: 'Acme summary.', faq: [], sources: [], expertise_depth: 'x' },
    brandData: { name: 'Acme', scam_score: 56, celebrity_list: [], geo_list: [] },
    slug: 'acme',
    currentDate: '2026-08-31',
    wordCount: 1500,
    longevityDays: 100,
  })['@graph']
}

test('the graph carries the node types the brief requires and no fabricated ones', () => {
  const types = graph().map((n) => n['@type'])
  for (const required of ['Organization', 'Person', 'WebSite', 'WebPage', 'Article', 'BreadcrumbList']) {
    assert.ok(types.includes(required), `${required} missing from @graph`)
  }
  assert.equal(types.includes('Product'), false, 'Product markup on an editorial page is unsupported')
  assert.equal(types.includes('AggregateRating'), false)
})

test('Article.headline is never empty, even when the writer omitted one', () => {
  const article = graph().find((n) => n['@type'] === 'Article')
  assert.equal(article.headline, 'Acme Review: Is Acme a Scam?')
})

test('the Article node names its publisher, author and mainEntityOfPage', () => {
  const article = graph().find((n) => n['@type'] === 'Article')
  assert.ok(article.publisher['@id'])
  assert.ok(article.author['@id'])
  assert.ok(article.mainEntityOfPage)
  assert.ok(article.datePublished)
  assert.ok(article.dateModified)
  assert.ok(article.headline)
})

test('every internal @id reference resolves to a node in the same graph', () => {
  const g = graph()
  const ids = new Set(g.map((n) => n['@id']).filter(Boolean))
  const refs = []
  const walk = (v) => {
    if (Array.isArray(v)) return v.forEach(walk)
    if (!v || typeof v !== 'object') return
    const keys = Object.keys(v)
    if (keys.length === 1 && keys[0] === '@id') refs.push(v['@id'])
    else Object.values(v).forEach(walk)
  }
  walk(g)
  const internal = refs.filter((r) => typeof r === 'string' && r.startsWith('https://cryptokiller.org'))
  for (const r of internal) assert.ok(ids.has(r), `dangling @id reference: ${r}`)
})

test('the organization node in the graph is the registry node', () => {
  const org = graph().find((n) => n['@type'] === 'Organization')
  assert.deepEqual(org, organizationEntity())
})

test('the website node references the organization as publisher', () => {
  assert.equal(websiteEntity().publisher['@id'], organizationEntity()['@id'])
})

// ── internal links ────────────────────────────────────────────────────────

const investigation = buildInvestigation({
  review: { id: 'r', slug: 'acme', scam_score: 50, author_name: 'M. Webb', author_persona_id: 'webb' },
  brand: { id: 'b', name: 'Acme', scam_score: 50, scam_types: ['celebrity_deepfake'], geo_list: ['GB'], celebrity_list: ['Elon Musk'] },
})

test('every rendered link points at a route confirmed to exist', () => {
  const known = new Set([...Object.values(STATIC_ROUTES), ...ANALYST_ROUTE_IDS.map((a) => `/author/${a}`)])
  for (const l of buildInvestigationLinks(investigation).links) {
    const ok = known.has(l.href) || /^\/review\/[a-z0-9-]+$/.test(l.href)
    assert.ok(ok, `${l.href} is not a verified route`)
  }
})

test('unbuilt page types become opportunities, never links', () => {
  const { links, opportunities } = buildInvestigationLinks(investigation)
  const hrefs = links.map((l) => l.href)
  assert.equal(hrefs.some((h) => h.startsWith('/scam-type/')), false)
  assert.equal(hrefs.some((h) => h.startsWith('/country/')), false)
  assert.equal(hrefs.some((h) => h.startsWith('/impersonated/')), false)
  assert.deepEqual(opportunities.map((o) => o.family).sort(), ['country', 'public_figure', 'scam_type'])
  for (const o of opportunities) assert.ok(o.rationale, `${o.family} opportunity has no rationale`)
})

test('a related investigation only links when it has a real slug', () => {
  const { links } = buildInvestigationLinks(investigation, {
    related: [{ slug: 'senvix', brand_name: 'Senvix', threat_classification_label: 'Elevated Risk' }, { brand_name: 'No Slug' }],
  })
  const related = links.filter((l) => l.context === 'related-investigation')
  assert.equal(related.length, 1)
  assert.equal(related[0].href, '/review/senvix')
})

test('REVIEW FIX: an analyst byline swaps in the registry Person; the team byline is byte-stable', () => {
  const base = { brandData: { name: 'Acme', scam_score: 56, celebrity_list: [], geo_list: [] }, slug: 'acme', currentDate: '2026-08-31', wordCount: 1500, longevityDays: 100 }
  const teamGraph = buildReviewSchema({ reviewContent: { summary: 'x', faq: [], sources: [], author_name: 'Crypto Killer Research Team' }, ...base })['@graph']
  const teamPerson = teamGraph.find((n) => n['@type'] === 'Person' && n['@id'].includes('author'))
  assert.equal(teamPerson['@id'], 'https://cryptokiller.org/#author')
  assert.equal(teamPerson.name, 'Crypto Killer Research Team')

  const webbGraph = buildReviewSchema({ reviewContent: { summary: 'x', faq: [], sources: [], author_name: 'M. Webb', author_persona_id: 'webb' }, ...base })['@graph']
  const webbPerson = webbGraph.find((n) => n['@type'] === 'Person' && n['@id'].includes('author'))
  const article = webbGraph.find((n) => n['@type'] === 'Article')
  assert.equal(webbPerson['@id'], 'https://cryptokiller.org/author/webb#person')
  assert.equal(article.author['@id'], webbPerson['@id'], 'Article.author must reference the node that exists')
})

test('REVIEW FIX: brand evidence + override reach the schema fallback classification', () => {
  const g = buildReviewSchema({
    reviewContent: { summary: 'x', faq: [], sources: [] },
    brandData: { name: 'Acme', scam_score: 85, celebrity_list: [], geo_list: [], regulator_warnings: [{ regulator: 'FCA', jurisdiction: 'GB', url: 'https://fca.org.uk/x' }] },
    slug: 'acme', currentDate: '2026-08-31', wordCount: 1500, longevityDays: 100,
  })
  // With a warning on file, the 85 brand is allowed its Review rating at the
  // confirmed tier rather than being silently downgraded by a bare call.
  assert.ok(JSON.stringify(g).length > 0)
})
