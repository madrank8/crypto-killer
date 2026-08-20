'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const { proposeSullivanType } = require('../../lib/topical-map/readiness/propose-sullivan-type')
const { gatherStackEvidence } = require('../../lib/topical-map/readiness/gather-stack')
const {
  gatherFirecrawlEvidence,
  mergeFirecrawlIntoEvidence,
  isAllowedFirecrawlUrl,
} = require('../../lib/topical-map/readiness/gather-firecrawl')

// ── proposeSullivanType ──────────────────────────────────────────────────────

describe('proposeSullivanType', () => {
  it('brand_review content_type maps to firsthand_review', () => {
    assert.equal(
      proposeSullivanType({ title: 'Quantum AI Review', content_type: 'brand_review', url_path: '/x/' }),
      'firsthand_review'
    )
  })

  it('/review/ in url_path maps to firsthand_review even without content_type', () => {
    assert.equal(
      proposeSullivanType({ title: 'Is Quantum AI a scam?', url_path: '/review/quantum-ai/' }),
      'firsthand_review'
    )
  })

  it('glossary/definition/faq hub signal in title maps to infrastructure', () => {
    assert.equal(proposeSullivanType({ title: 'Crypto Scam Glossary', url_path: '/glossary/' }), 'infrastructure')
    assert.equal(proposeSullivanType({ title: 'What Is a Rug Pull? Definition', url_path: '/wiki/rug-pull/' }), 'infrastructure')
  })

  it('glossary/FAQ signal in content_format maps to infrastructure', () => {
    assert.equal(
      proposeSullivanType({ title: 'Common Questions', content_format: 'FAQ Hub', url_path: '/faq/' }),
      'infrastructure'
    )
  })

  it('/research/ url_path maps to original_data_study', () => {
    assert.equal(
      proposeSullivanType({ title: 'Ad Spend Report', url_path: '/research/ad-spend/' }),
      'original_data_study'
    )
  })

  it('proprietary dataset / n= / survey signal maps to original_data_study', () => {
    assert.equal(
      proposeSullivanType({ title: 'Our Survey of 500 Victims', notes: 'proprietary dataset, n=512' }),
      'original_data_study'
    )
  })

  it('an unknown educational topic with no clear signal proposes null (never guesses)', () => {
    assert.equal(
      proposeSullivanType({ title: 'How Crypto Scams Work', content_type: 'educational', url_path: '/learn/how-crypto-scams-work/' }),
      null
    )
  })

  it('case_study and contrarian_opinion are never auto-proposed (no deterministic signal for them)', () => {
    assert.equal(proposeSullivanType({ title: 'A Case Study of Recovery', content_type: 'case_study' }), null)
    assert.equal(proposeSullivanType({ title: 'Everyone is wrong about crypto scams', content_type: 'contrarian_opinion' }), null)
  })

  it('handles missing/malformed topic without throwing', () => {
    assert.equal(proposeSullivanType(null), null)
    assert.equal(proposeSullivanType(undefined), null)
    assert.equal(proposeSullivanType({}), null)
  })

  it('/alerts/ and /safety/ map to firsthand_review', () => {
    assert.equal(
      proposeSullivanType({ title: 'Circle K Bitcoin ATM Scam', url_path: '/alerts/circle-k/' }),
      'firsthand_review'
    )
    assert.equal(
      proposeSullivanType({ title: 'Coinbase Text Message Scam', url_path: '/safety/coinbase-text/' }),
      'firsthand_review'
    )
  })

  it('/guides/ recovery/report/checklist titles map to firsthand_review', () => {
    assert.equal(
      proposeSullivanType({ title: 'Crypto Recovery Checklist After a Scam', url_path: '/guides/crypto-recovery-checklist/' }),
      'firsthand_review'
    )
    assert.equal(
      proposeSullivanType({ title: 'How to Report a Crypto Scam to IC3', url_path: '/guides/report-ic3/' }),
      'firsthand_review'
    )
    assert.equal(
      proposeSullivanType({ title: 'Beginner Wallet Setup', url_path: '/guides/wallet-setup/' }),
      null
    )
  })

  it('/check/ and /tools/ map to infrastructure', () => {
    assert.equal(
      proposeSullivanType({ title: 'Check Any Crypto Platform', url_path: '/check/platform/' }),
      'infrastructure'
    )
    assert.equal(
      proposeSullivanType({ title: 'Wallet Safety Tools', url_path: '/tools/wallet-safety/' }),
      'infrastructure'
    )
  })

  it('/scams/ type pages stay unclassified (no forced data study)', () => {
    assert.equal(
      proposeSullivanType({ title: 'Pig Butchering Scams Explained', url_path: '/scams/pig-butchering/' }),
      null
    )
  })
})

// ── gatherStackEvidence: infrastructure ──────────────────────────────────────

describe('gatherStackEvidence: infrastructure', () => {
  it('does not invent Wikidata Q-IDs when none found in the stack', async () => {
    const out = await gatherStackEvidence({
      topic: {
        title: 'Crypto Scam',
        url_path: '/wiki/crypto-scam/',
        content_type: 'educational',
        internal_links_to: ['a', 'b', 'c'],
      },
      proposeType: 'infrastructure',
      supaFetch: async () => [],
      fetchImpl: async () => ({ ok: false }),
    })
    assert.equal(out.content_type, 'infrastructure')
    assert.equal(out.forcing_inputs.entity_id, undefined)
    assert.ok(out.missing.includes('entity_id'))
  })

  it('fills entity_id only from the curated Wikidata registry, with a cited source', async () => {
    const out = await gatherStackEvidence({
      topic: {
        id: 't-1',
        title: 'Pig Butchering Scam Explained',
        target_keyword: 'pig butchering scam',
        url_path: '/wiki/pig-butchering-scam/',
        internal_links_to: ['/a/', '/b/', '/c/'],
      },
      proposeType: 'infrastructure',
      supaFetch: async () => [],
    })
    assert.equal(out.forcing_inputs.entity_id, 'Q108823641')
    assert.ok(!out.missing.includes('entity_id'))
    const src = out.sources.find((s) => s.field === 'entity_id')
    assert.ok(src, 'expected a cited source for entity_id')
    assert.ok(src.quote)
  })

  it('never treats a Wikidata property id (e.g. P902) as a verified Q-ID', async () => {
    const out = await gatherStackEvidence({
      topic: { title: 'Better Business Bureau', target_keyword: 'better business bureau' },
      proposeType: 'infrastructure',
      supaFetch: async () => [],
    })
    // registry entry for bbb carries qid_override Q806097 (the real entity), never P902
    assert.equal(out.forcing_inputs.entity_id, 'Q806097')
    assert.ok(!String(out.forcing_inputs.entity_id).startsWith('P'))
  })

  it('fills internal_link_targets from topic.internal_links_to already on the map', async () => {
    const out = await gatherStackEvidence({
      topic: { title: 'X', internal_links_to: ['/a/', '/b/'] },
      proposeType: 'infrastructure',
      supaFetch: async () => [],
    })
    assert.deepEqual(out.forcing_inputs.internal_link_targets, ['/a/', '/b/'])
  })

  it('leaves internal_link_targets missing when the topic has none', async () => {
    const out = await gatherStackEvidence({
      topic: { title: 'X', internal_links_to: [] },
      proposeType: 'infrastructure',
      supaFetch: async () => [],
    })
    assert.equal(out.forcing_inputs.internal_link_targets, undefined)
    assert.ok(out.missing.includes('internal_link_targets'))
  })

  it('fills sub_entities only when >=3 real linked child titles exist in our graph', async () => {
    const out = await gatherStackEvidence({
      topic: { id: 't-parent', title: 'Crypto Scam Types' },
      proposeType: 'infrastructure',
      supaFetch: async (path) => {
        if (path.includes('/topics?parent_id=eq.t-parent')) {
          return [{ id: 'c1', title: 'Pig Butchering' }, { id: 'c2', title: 'Romance Scam' }, { id: 'c3', title: 'Rug Pull' }]
        }
        return []
      },
    })
    assert.deepEqual(out.forcing_inputs.sub_entities, ['Pig Butchering', 'Romance Scam', 'Rug Pull'])
    assert.ok(!out.missing.includes('sub_entities'))
  })

  it('fills semantic_role from glossary/FAQ/definition title signals', async () => {
    const out = await gatherStackEvidence({
      topic: { title: 'Crypto Scam Glossary', internal_links_to: ['/a/', '/b/', '/c/'] },
      proposeType: 'infrastructure',
      supaFetch: async () => [],
    })
    assert.equal(out.forcing_inputs.semantic_role, 'glossary')
    assert.ok(!out.missing.includes('semantic_role'))
  })

  it('leaves sub_entities missing when fewer than 3 real linked child titles exist', async () => {
    const out = await gatherStackEvidence({
      topic: { id: 't-parent', title: 'Crypto Scam Types' },
      proposeType: 'infrastructure',
      supaFetch: async () => [{ id: 'c1', title: 'Pig Butchering' }],
    })
    assert.equal(out.forcing_inputs.sub_entities, undefined)
    assert.ok(out.missing.includes('sub_entities'))
  })
})

// ── gatherStackEvidence: firsthand_review ────────────────────────────────────

function reviewHtmlWithQuotes(quotes) {
  return `<article><p>Intro.</p>${quotes.map((q) => `<p>${q}</p>`).join('')}</article>`
}

describe('gatherStackEvidence: firsthand_review', () => {
  it('fills anecdotes only from provided review HTML quotes (>=3 distinct quotes)', async () => {
    const html = reviewHtmlWithQuotes([
      '"I sent them 400 dollars and never heard back again after that day."',
      '"Support stopped responding within twenty four hours of my withdrawal request."',
      '"The platform locked my account the moment I asked to cash out my balance."',
    ])
    const out = await gatherStackEvidence({
      topic: { title: 'Quantum AI Review', content_type: 'brand_review', url_path: '/review/quantum-ai/' },
      proposeType: 'firsthand_review',
      supaFetch: async () => [
        { id: 'r-1', slug: 'quantum-ai', full_article: html, author_credentials: 'Lead investigator, 6 years in fraud analysis' },
      ],
    })
    assert.equal(out.content_type, 'firsthand_review')
    assert.equal(out.forcing_inputs.direct_anecdotes.length, 3)
    assert.equal(out.forcing_inputs.credentials, 'Lead investigator, 6 years in fraud analysis')
    assert.ok(!out.missing.includes('direct_anecdotes'))
    assert.ok(out.sources.some((s) => s.field === 'direct_anecdotes'))
    assert.ok(out.sources.some((s) => s.field === 'credentials'))
  })

  it('with fewer than 3 quotes: reports missing, does not pad forcing_inputs', async () => {
    const html = reviewHtmlWithQuotes([
      '"I sent them 400 dollars and never heard back again after that day."',
      '"Support stopped responding within twenty four hours of my request."',
    ])
    const out = await gatherStackEvidence({
      topic: { title: 'Quantum AI Review', content_type: 'brand_review', url_path: '/review/quantum-ai/' },
      proposeType: 'firsthand_review',
      supaFetch: async () => [{ id: 'r-1', slug: 'quantum-ai', full_article: html, author_credentials: null }],
    })
    assert.equal(out.forcing_inputs.direct_anecdotes, undefined)
    assert.ok(out.missing.includes('direct_anecdotes'))
    assert.equal(out.forcing_inputs.credentials, undefined)
    assert.ok(out.missing.includes('credentials'))
  })

  it('never invents credentials/anecdotes when no review is found in the stack or live site', async () => {
    const out = await gatherStackEvidence({
      topic: { title: 'Unknown Brand Review', content_type: 'brand_review', url_path: '/review/unknown-brand/' },
      proposeType: 'firsthand_review',
      supaFetch: async () => [],
      fetchImpl: async () => ({ ok: false }),
    })
    assert.deepEqual(out.forcing_inputs, {})
    assert.ok(out.missing.includes('direct_anecdotes'))
    assert.ok(out.missing.includes('credentials'))
    assert.equal(out.sources.length, 0)
  })

  it('field_observation_count stays missing when SpyOwl returns no brand rows', async () => {
    const html = reviewHtmlWithQuotes([
      '"Quote one that is long enough to count as an anecdote here."',
      '"Quote two that is long enough to count as an anecdote here too."',
      '"Quote three that is long enough to count as an anecdote as well."',
    ])
    const out = await gatherStackEvidence({
      topic: { title: 'X Review', content_type: 'brand_review', url_path: '/review/x/' },
      proposeType: 'firsthand_review',
      supaFetch: async () => [{ id: 'r-1', slug: 'x', full_article: html }],
    })
    assert.equal(out.forcing_inputs.field_observation_count, undefined)
    assert.equal(out.forcing_inputs.recurring_pattern, undefined)
    assert.ok(out.missing.includes('field_observation_count'))
    assert.ok(out.missing.includes('recurring_pattern'))
  })

  it('fills field_observation_count from a cited SpyOwl brand query (never a generic boast)', async () => {
    const html = reviewHtmlWithQuotes([
      '"Quote one that is long enough to count as an anecdote here."',
      '"Quote two that is long enough to count as an anecdote here too."',
      '"Quote three that is long enough to count as an anecdote as well."',
    ])
    const brands = [
      { id: 'b1', geo_list: ['US'] },
      { id: 'b2', geo_list: ['US'] },
      { id: 'b3', geo_list: ['US'] },
    ]
    const out = await gatherStackEvidence({
      topic: {
        title: 'Quantum AI Review',
        target_keyword: 'quantum ai',
        content_type: 'brand_review',
        url_path: '/review/quantum-ai/',
      },
      proposeType: 'firsthand_review',
      supaFetch: async (path) => {
        if (path.startsWith('/scam_brands')) return brands
        if (path.startsWith('/reviews?slug=')) {
          return [{ id: 'r-1', slug: 'quantum-ai', full_article: html, author_credentials: 'Lead investigator' }]
        }
        return []
      },
    })
    assert.match(out.forcing_inputs.field_observation_count, /3 SpyOwl brand rows/)
    assert.match(out.forcing_inputs.field_observation_count, /quantum ai/)
    assert.match(out.forcing_inputs.recurring_pattern, /geo US/)
    assert.ok(out.sources.some((s) => s.field === 'field_observation_count' && /quantum ai/.test(s.quote)))
    assert.ok(!out.missing.includes('field_observation_count'))
  })

  it('fills anecdotes from overlapping published content (slug/keyword match)', async () => {
    const html = reviewHtmlWithQuotes([
      '"I sent them 400 dollars and never heard back again after that day."',
      '"Support stopped responding within twenty four hours of my withdrawal request."',
      '"The platform locked my account the moment I asked to cash out my balance."',
    ])
    const out = await gatherStackEvidence({
      topic: {
        title: 'Circle K Bitcoin ATM Scam',
        target_keyword: 'circle k bitcoin',
        url_path: '/alerts/circle-k/',
        slug: 'circle-k',
      },
      proposeType: 'firsthand_review',
      supaFetch: async (path) => {
        if (path.startsWith('/content?status=eq.published')) {
          return [{ id: 'c-1', slug: 'circle-k-atm', title: 'Circle K Bitcoin ATM alert', full_article: html }]
        }
        return []
      },
    })
    assert.equal(out.forcing_inputs.direct_anecdotes.length, 3)
    assert.ok(out.sources.some((s) => s.field === 'direct_anecdotes'))
    assert.ok(!out.missing.includes('direct_anecdotes'))
  })

  it('never invents a third anecdote when overlapping content only has two quotes', async () => {
    const html = reviewHtmlWithQuotes([
      '"I sent them 400 dollars and never heard back again after that day."',
      '"Support stopped responding within twenty four hours of my withdrawal request."',
    ])
    const out = await gatherStackEvidence({
      topic: {
        title: 'Circle K Bitcoin ATM Scam',
        target_keyword: 'circle k bitcoin',
        url_path: '/alerts/circle-k/',
        slug: 'circle-k',
      },
      proposeType: 'firsthand_review',
      supaFetch: async (path) => {
        if (path.startsWith('/content?status=eq.published')) {
          return [{ id: 'c-1', slug: 'circle-k-atm', title: 'Circle K Bitcoin ATM alert', full_article: html }]
        }
        return []
      },
    })
    assert.equal(out.forcing_inputs.direct_anecdotes, undefined)
    assert.ok(out.missing.includes('direct_anecdotes'))
  })

  it('falls back to a live fetch when no DB row exists', async () => {
    const html = reviewHtmlWithQuotes([
      '"Quote one that is long enough to count as an anecdote here."',
      '"Quote two that is long enough to count as an anecdote here too."',
      '"Quote three that is long enough to count as an anecdote as well."',
    ])
    let fetchedUrl = null
    const out = await gatherStackEvidence({
      topic: { title: 'Live Only Review', content_type: 'brand_review', url_path: '/review/live-only/' },
      proposeType: 'firsthand_review',
      supaFetch: async () => [],
      fetchImpl: async (url) => {
        fetchedUrl = url
        return { ok: true, text: async () => html }
      },
    })
    assert.equal(fetchedUrl, '/review/live-only/')
    assert.equal(out.forcing_inputs.direct_anecdotes.length, 3)
  })
})

// ── gatherStackEvidence: no proposal / other types ───────────────────────────

describe('gatherStackEvidence: no proposal', () => {
  it('when proposeType/proposal is null, gathers nothing and invents nothing', async () => {
    const out = await gatherStackEvidence({
      topic: { title: 'Ambiguous Topic', content_type: 'educational' },
      proposeType: null,
      supaFetch: async () => {
        throw new Error('should not be called')
      },
    })
    assert.equal(out.content_type, null)
    assert.deepEqual(out.forcing_inputs, {})
    assert.deepEqual(out.sources, [])
    assert.deepEqual(out.missing, [])
  })

  it('derives proposeType from the topic itself when proposeType is omitted', async () => {
    const out = await gatherStackEvidence({
      topic: { title: 'Quantum AI Review', content_type: 'brand_review', url_path: '/review/quantum-ai/' },
      supaFetch: async () => [],
    })
    assert.equal(out.content_type, 'firsthand_review')
  })

  it('fills original_data_study from a real SpyOwl brand sample (n>=100), never invents n', async () => {
    const brands = Array.from({ length: 120 }, (_, i) => ({
      id: `b${i}`,
      last_seen_at: '2026-08-01T00:00:00Z',
      scam_score: i < 30 ? 90 : 40,
    }))
    const out = await gatherStackEvidence({
      topic: { title: 'Ad Spend Report', url_path: '/research/ad-spend/' },
      proposeType: 'original_data_study',
      supaFetch: async (path) => (path.startsWith('/scam_brands') ? brands : []),
    })
    assert.equal(out.forcing_inputs.dataset_source, 'internal_db')
    assert.equal(out.forcing_inputs.n_size, 120)
    assert.equal(out.forcing_inputs.collection_date, '2026-08-01')
    assert.match(out.forcing_inputs.novel_finding, /120 tracked brands/)
    assert.ok(!out.missing.includes('n_size'))
  })

  it('leaves original_data_study missing when the corpus sample is below n=100', async () => {
    const out = await gatherStackEvidence({
      topic: { title: 'Ad Spend Report', url_path: '/research/ad-spend/' },
      proposeType: 'original_data_study',
      supaFetch: async () => [{ id: 'b1', last_seen_at: '2026-08-01', scam_score: 90 }],
    })
    assert.deepEqual(out.forcing_inputs, {})
    assert.ok(out.missing.includes('n_size'))
  })
})

// ── gatherFirecrawlEvidence ──────────────────────────────────────────────────

describe('gatherFirecrawlEvidence', () => {
  it('returns skipped when no apiKey is passed and no env key is set', async () => {
    const prev = process.env.FIRECRAWL_API_KEY
    delete process.env.FIRECRAWL_API_KEY
    try {
      const out = await gatherFirecrawlEvidence({
        urls: ['https://cryptokiller.org/review/quantum-ai/'],
        fetchImpl: async () => {
          throw new Error('should not be called')
        },
      })
      assert.deepEqual(out, { skipped: true })
    } finally {
      if (prev !== undefined) process.env.FIRECRAWL_API_KEY = prev
    }
  })

  it('scrapes the current Firecrawl v2 endpoint with the expected request shape', async () => {
    let capturedUrl = null
    let capturedOpts = null
    const fetchImpl = async (url, opts) => {
      capturedUrl = url
      capturedOpts = opts
      return {
        ok: true,
        json: async () => ({ success: true, data: { markdown: 'hello', links: ['https://cryptokiller.org/other/'] } }),
      }
    }
    const out = await gatherFirecrawlEvidence({
      urls: ['https://cryptokiller.org/review/quantum-ai/'],
      apiKey: 'fc-test-key',
      fetchImpl,
    })
    assert.equal(capturedUrl, 'https://api.firecrawl.dev/v2/scrape')
    assert.equal(capturedOpts.method, 'POST')
    assert.equal(capturedOpts.headers.Authorization, 'Bearer fc-test-key')
    const body = JSON.parse(capturedOpts.body)
    assert.equal(body.url, 'https://cryptokiller.org/review/quantum-ai/')
    assert.deepEqual(body.formats, ['markdown', 'links'])
    assert.equal(out.pages.length, 1)
    assert.equal(out.pages[0].markdown, 'hello')
    assert.deepEqual(out.pages[0].links, ['https://cryptokiller.org/other/'])
  })

  it('rejects an arbitrary competitor URL that is not our domain and not already linked', async () => {
    let calls = 0
    const out = await gatherFirecrawlEvidence({
      urls: ['https://some-competitor-blog.example/best-crypto-scam-list/'],
      apiKey: 'fc-test-key',
      allowedOutboundLinks: ['https://ftc.gov/known-source/'],
      fetchImpl: async () => {
        calls += 1
        return { ok: true, json: async () => ({ data: { markdown: '', links: [] } }) }
      },
    })
    assert.equal(calls, 0)
    assert.deepEqual(out.pages, [])
  })

  it('allows our own domain and an outbound URL already linked from our pages', async () => {
    const scraped = []
    const out = await gatherFirecrawlEvidence({
      urls: ['https://cryptokiller.org/wiki/pig-butchering/', 'https://ftc.gov/known-source/', 'https://random-serp-result.example/'],
      apiKey: 'fc-test-key',
      allowedOutboundLinks: ['https://ftc.gov/known-source/'],
      fetchImpl: async (_endpoint, opts) => {
        scraped.push(JSON.parse(opts.body).url)
        return { ok: true, json: async () => ({ data: { markdown: '', links: [] } }) }
      },
    })
    assert.equal(scraped.length, 2)
    assert.ok(scraped.includes('https://cryptokiller.org/wiki/pig-butchering/'))
    assert.ok(scraped.includes('https://ftc.gov/known-source/'))
    assert.ok(!scraped.includes('https://random-serp-result.example/'))
    assert.equal(out.pages.length, 2)
  })

  it('surfaces per-url scrape failures in error without throwing', async () => {
    const out = await gatherFirecrawlEvidence({
      urls: ['https://cryptokiller.org/wiki/broken/'],
      apiKey: 'fc-test-key',
      fetchImpl: async () => ({ ok: false, status: 500 }),
    })
    assert.equal(out.pages.length, 0)
    assert.match(out.error, /500/)
  })
})

describe('isAllowedFirecrawlUrl', () => {
  it('always allows our own domain, including subdomains', () => {
    assert.equal(isAllowedFirecrawlUrl('https://cryptokiller.org/x/'), true)
    assert.equal(isAllowedFirecrawlUrl('https://www.cryptokiller.org/x/'), true)
    assert.equal(isAllowedFirecrawlUrl('https://blog.cryptokiller.org/x/'), true)
  })

  it('allows an outbound URL only when it is already in the known-links list', () => {
    assert.equal(isAllowedFirecrawlUrl('https://ftc.gov/a/', ['https://ftc.gov/a/']), true)
    assert.equal(isAllowedFirecrawlUrl('https://ftc.gov/a/', []), false)
    assert.equal(isAllowedFirecrawlUrl('https://ftc.gov/a/'), false)
  })

  it('rejects malformed URLs and non-string input without throwing', () => {
    assert.equal(isAllowedFirecrawlUrl('not a url'), false)
    assert.equal(isAllowedFirecrawlUrl(null), false)
    assert.equal(isAllowedFirecrawlUrl(undefined), false)
  })
})

// ── mergeFirecrawlIntoEvidence ───────────────────────────────────────────────

describe('mergeFirecrawlIntoEvidence', () => {
  it('fills direct_anecdotes from >=3 distinct quoted sentences across scraped pages', () => {
    const stackResult = {
      content_type: 'firsthand_review',
      forcing_inputs: {},
      sources: [],
      missing: ['direct_anecdotes', 'credentials'],
    }
    const firecrawlPages = [
      {
        url: 'https://cryptokiller.org/review/quantum-ai/',
        markdown:
          '"I sent them 400 dollars and never heard back again after that day." Some filler text here. ' +
          '"Support stopped responding within twenty four hours of my withdrawal request."',
      },
      {
        url: 'https://ftc.gov/known-source/',
        markdown: '"The platform locked my account the moment I asked to cash out my balance."',
      },
    ]
    const out = mergeFirecrawlIntoEvidence(stackResult, firecrawlPages, 'firsthand_review')
    assert.equal(out.forcing_inputs.direct_anecdotes.length, 3)
    assert.ok(!out.missing.includes('direct_anecdotes'))
    assert.ok(out.missing.includes('credentials')) // untouched: no honest firecrawl source for it here
    assert.ok(out.sources.some((s) => s.field === 'direct_anecdotes' && s.url === 'https://cryptokiller.org/review/quantum-ai/'))
  })

  it('never pads anecdotes below the 3-quote minimum', () => {
    const stackResult = { content_type: 'firsthand_review', forcing_inputs: {}, sources: [], missing: ['direct_anecdotes'] }
    const firecrawlPages = [
      {
        url: 'https://cryptokiller.org/review/x/',
        markdown: '"Only one quote here that is long enough to matter for this test."',
      },
    ]
    const out = mergeFirecrawlIntoEvidence(stackResult, firecrawlPages, 'firsthand_review')
    assert.equal(out.forcing_inputs.direct_anecdotes, undefined)
    assert.ok(out.missing.includes('direct_anecdotes'))
  })

  it('never invents a Wikidata Q-ID even when firecrawl pages are present', () => {
    const stackResult = {
      content_type: 'infrastructure',
      forcing_inputs: {},
      sources: [],
      missing: ['entity_id', 'sub_entities'],
    }
    const firecrawlPages = [
      { url: 'https://cryptokiller.org/wiki/crypto-scam/', markdown: 'Wikidata: Q999999 is definitely the entity id.' },
    ]
    const out = mergeFirecrawlIntoEvidence(stackResult, firecrawlPages, 'infrastructure')
    assert.equal(out.forcing_inputs.entity_id, undefined)
    assert.ok(out.missing.includes('entity_id'))
    assert.equal(out.forcing_inputs.sub_entities, undefined)
    assert.ok(out.missing.includes('sub_entities'))
  })

  it('is a no-op when the stack result did not report direct_anecdotes as missing', () => {
    const stackResult = {
      content_type: 'firsthand_review',
      forcing_inputs: { direct_anecdotes: ['already', 'have', 'three'] },
      sources: [],
      missing: [],
    }
    const firecrawlPages = [
      {
        url: 'https://cryptokiller.org/review/x/',
        markdown:
          '"New quote one that would otherwise be long enough to count here." ' +
          '"New quote two that would otherwise be long enough to count here." ' +
          '"New quote three that would otherwise be long enough to count here."',
      },
    ]
    const out = mergeFirecrawlIntoEvidence(stackResult, firecrawlPages)
    assert.deepEqual(out.forcing_inputs.direct_anecdotes, ['already', 'have', 'three'])
  })

  it('handles no firecrawl pages gracefully', () => {
    const stackResult = { content_type: 'firsthand_review', forcing_inputs: {}, sources: [], missing: ['direct_anecdotes'] }
    const out = mergeFirecrawlIntoEvidence(stackResult, [], 'firsthand_review')
    assert.equal(out.forcing_inputs.direct_anecdotes, undefined)
    assert.ok(out.missing.includes('direct_anecdotes'))
  })
})
